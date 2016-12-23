'use strict';

var DB_PORT = 27017;
var DB_HOST = "localhost";
var DB_NAME = "hiqCloudDB";

var mc = require('mongodb').MongoClient


mc.connect("mongodb://" + DB_HOST + ":" + DB_PORT + "/" + DB_NAME, function (err, models) {
	if (err) throw err
	require("./cloudscript.js")(models);
});