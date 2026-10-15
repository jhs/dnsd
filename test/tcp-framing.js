// Copyright 2012 Iris Couch, all rights reserved.
//
// TCP framing without opening network sockets.

var fs = require('fs')
var events = require('events')
var test = require('tap').test
var API = require('../named')

var query = fs.readFileSync(__dirname + '/../_test_data/oreilly.com-query')
var frame = Buffer.concat([new Buffer([query.length >> 8, query.length & 255]), query])

function connection() {
  var socket = new events.EventEmitter()
  socket.paused = 0
  socket.destroyed = 0
  socket.pause = function() { socket.paused += 1 }
  socket.destroy = function() { socket.destroyed += 1 }
  return socket
}

var chunks = {
  'one chunk': [frame],
  'split prefix': [frame.slice(0, 1), frame.slice(1)],
  'separate prefix': [frame.slice(0, 2), frame.slice(2)],
  'split payload': [frame.slice(0, 7), frame.slice(7)],
  'one byte at a time': []
}
for(var i = 0; i < frame.length; i++)
  chunks['one byte at a time'].push(frame.slice(i, i + 1))

Object.keys(chunks).forEach(function(name) {
  test('TCP frame: ' + name, function(t) {
    var requests = 0
    var server = API.createServer(function(req) {
      requests += 1
      t.equal(req.question[0].name, 'oreilly.com', 'decoded the complete query')
    })
    var socket = connection()
    server.on_tcp_connection(socket)

    chunks[name].forEach(function(chunk) { socket.emit('data', chunk) })
    t.equal(requests, 1, 'dispatched exactly one request')
    t.equal(socket.paused, 1, 'stopped reading after the complete frame')
    t.equal(socket.listeners('data').length, 0, 'removed the buffering listener')
    socket.emit('data', frame)
    t.equal(requests, 1, 'later data cannot dispatch another request')
    t.equal(socket.destroyed, 0, 'left the connection open for its response')
    t.end()
  })
})

var extra = Buffer.concat([frame, new Buffer([0])])
var oversized = {
  'one chunk': [extra],
  'separate prefix': [extra.slice(0, 2), extra.slice(2)],
  'split payload': [extra.slice(0, 7), extra.slice(7)],
  'above the maximum frame size': [new Buffer([255, 255]), new Buffer(65536)]
}

Object.keys(oversized).forEach(function(name) {
  test('Reject oversized TCP frame: ' + name, function(t) {
    var requests = 0
    var server = API.createServer(function() { requests += 1 })
    var socket = connection()
    server.on_tcp_connection(socket)

    oversized[name].forEach(function(chunk) { socket.emit('data', chunk) })
    t.equal(socket.destroyed, 1, 'closed the oversized request')
    t.equal(socket.listeners('data').length, 0, 'removed the buffering listener')
    socket.emit('data', frame)
    t.equal(requests, 0, 'did not parse oversized or later data')
    t.end()
  })
})

test('Malformed complete TCP frame preserves error reporting', function(t) {
  var server = API.createServer()
  var socket = connection()
  var errors = 0
  server.on('error', function(message, err, info) {
    errors += 1
    t.equal(message, 'Error processing request', 'kept the error message')
    t.ok(err instanceof Error, 'reported the parsing error')
    t.equal(info, socket, 'reported the connection')
    t.equal(socket.listeners('data').length, 0, 'stopped buffering before emitting the error')
  })
  server.on_tcp_connection(socket)
  socket.emit('data', new Buffer([0, 0]))
  socket.emit('data', frame)
  t.equal(errors, 1, 'reported the malformed frame exactly once')
  t.end()
})

test('Closing a partial TCP frame stops buffering', function(t) {
  var server = API.createServer()
  var socket = connection()
  server.on_tcp_connection(socket)
  socket.emit('data', frame.slice(0, 7))
  socket.emit('close')
  t.equal(socket.listeners('data').length, 0, 'removed the buffering listener')
  t.equal(socket.listeners('close').length, 0, 'removed the cleanup listener')
  t.end()
})
