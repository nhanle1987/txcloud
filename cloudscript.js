'use strict';

var INS = {
	"SUCCESS": true,
	"ERROR": true,
	"FAILED": true
};

module.exports = function(models) {

	var crypto = require('crypto');
	var base64url = require('base64url');

	var net = require('net');
	var express = require('express');

	var sockets = {};
	var dump = console.log;

	function randomStringAsBase64(size) {
	  return base64url(crypto.randomBytes(size));
	}

	function currentTimestamp() {
		return new Date().getTime();
	}

	/** Sync */
	/*
	 * Callback method executed when a new TCP socket is opened.
	 */
	// test db - connection
	// models.collection('Console').find().toArray(function (err, result) {
	// 	if (err) throw err
	// 	console.log(result)
	// });
	 
	function newSocket(socket) {
		socket.setEncoding('ascii');
		// sockets.push(socket); 
		socket.on('data', function(data) {
			// dump(data);
			// id:4322343423sdwfaf2314;
			var cmd = data.trim().split(":");
			if(cmd[0] === "id") {
				// check device is registerd?
				// Console chưa được người dùng kích hoạt sẽ có:
				// + accessCode và codeGeneratedAt là rỗng.
				// + isOnline là 0 (không kết nối).
				models.collection('Console').findOne({
					"productId": cmd[1]
				}, function(err, inf) {
					if(err || !inf) {
						dump("ERROR: Product Code not found!", err);
						return;
					}
					// check valid client
					if(typeof inf.productId === "undefined" || !inf.productId) {
						socket.write("FAILED: invalid device.");
						return;
					}
					var cbAct = function(err, db) {
						if(err) {
							dump("ERROR: ", err);
							return;
						}
						socket.productId = cmd[1];
						socket._detail = inf;
						sockets[cmd[1]] = socket;
						dump(">> Client #" + cmd[1] + " is online!");
						socket.write("accessCode:" + inf.accessCode);
					};
					// check active status
					if(typeof inf.accessCode === "undefined" || inf.accessCode === "---" || !inf.accessCode) {
						inf.accessCode = randomStringAsBase64(6);
						inf.codeGeneratedAt = currentTimestamp();
						models.collection('Console').updateOne({
							"id": inf.id
						}, {
							$set: {
								"accessCode": inf.accessCode,
								"codeGeneratedAt": inf.codeGeneratedAt,
								"isOnline": 1
							}
						}, {upsert:true}, cbAct);
					} else {
						models.collection('Console').updateOne({
							"id": inf.id
						}, {
							$set: {
								"isOnline": 1
							}
						}, {upsert:true}, cbAct);
					}
				});
			} else {
				if(typeof this.responseCurrent !== "undefined") {
					// dump(data);
					try {
						this.responseCurrent.send(data);
					} catch(e) {
						dump(e);
					}
				}
			}
		});

		socket.on('end', function() {
			closeSocket(socket);
		});
	}

	/*
	 * Method executed when a socket ends
	 */
	function closeSocket(socket) {
		dump("<< Client #" + socket.productId + " is offline!");
		models.collection('Console').updateOne({
			"id": socket._detail.id
		}, {
			$set: {
				"isOnline": 0
			}
		}, {upsert:true}, function(err, mdl) {
			sockets[socket.productId] = null;
		});
	}

	// broadcast received data...
	function receiveData(data, actSocket) {
		dump(Object.keys(sockets));
		for(var inx in sockets) {
			var cSo = sockets[inx];
			if (cSo !== actSocket) {
				cSo.write(actSocket.productId + ": " + data);
			}
		}
	}

	function allowCrossOrigin(req, res,next) {
		/**
		 * Response settings
		 * @type {Object}
		 */
		var responseSettings = {
			"AccessControlAllowOrigin": req.headers.origin,
			"AccessControlAllowHeaders": "Content-Type,X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5,  Date, X-Api-Version, X-File-Name",
			"AccessControlAllowMethods": "POST, GET, PUT, DELETE, OPTIONS",
			"AccessControlAllowCredentials": true
		};

		/**
		 * Headers
		 */
		res.header("Access-Control-Allow-Credentials", responseSettings.AccessControlAllowCredentials);
		res.header("Access-Control-Allow-Origin",  responseSettings.AccessControlAllowOrigin);
		res.header("Access-Control-Allow-Headers", (req.headers['access-control-request-headers']) ? req.headers['access-control-request-headers'] : "x-requested-with");
		res.header("Access-Control-Allow-Methods", (req.headers['access-control-request-method']) ? req.headers['access-control-request-method'] : responseSettings.AccessControlAllowMethods);

		if ('OPTIONS' == req.method) {
			res.sendStatus(200);
		}
		else {
			next();
		}


	}
	// Create a new server and provide a callback for when a connection occurs
	var server = net.createServer(newSocket);


	var app = express();
	app.all('*', allowCrossOrigin);


	function processClientRequest_getDeviceList(req, res) {
		req.setEncoding('utf8');
		req.on('data', function (data) {
			var aJson = JSON.parse(data);
			var id = aJson.token;
			var method = aJson.method;
			// console.log(">> -", data);
			var currentConnection = sockets[id];
			if(typeof currentConnection === "undefined" || currentConnection == null) {
				return;
			}
			currentConnection.write(method, function() {
			});
			currentConnection.responseCurrent = res;
		});
	}
	function processRequest(req, res) {

		req.setEncoding('utf8');
		switch(req.method) {
			case "GET":
				var query = req.query;
				var token = query.access_token;
				var currentConnection = sockets[token];
				if(typeof currentConnection === "undefined" || currentConnection == null) {
					dump("ERROR: connection invalid!");
					return;
				}
				currentConnection.write(
					"getGeneral:" + JSON.stringify({
						"api": req.url.replace("access_token=" + token, ""),
						"method": "GET"
					})
				);
				currentConnection.responseCurrent = res;
				break;
			default:
				req.on('data', function (data) {
					var aJson = JSON.parse(data);
					var query = req.query;
					var token = query.access_token;
					var currentConnection = sockets[token];
					if(typeof currentConnection === "undefined" || currentConnection == null) {
						dump("ERROR: connection invalid!");
						return;
					}
					currentConnection.write(
						"fwGeneral:" + JSON.stringify({
							"api": req.url.replace("access_token=" + token, ""),
							"method": req.method,
							"body": data
						})
					);
					currentConnection.responseCurrent = res;
				});
				break;
		}
	}
	// app.get('/getDeviceList', function(req, res) {
	// 	processClientRequest(req, res);
	// });
	app.all('*', function(req, res) {
		// dump(req.url, req.method, req.query);
		processRequest(req, res);
	});

	// app.post('/registerConsoleToCloud', function(req, res) {
	// 	registerConsoleToCloud(req, res);
	// });


	// Listen on port
	server.listen(8088);
	app.listen(8089)
}