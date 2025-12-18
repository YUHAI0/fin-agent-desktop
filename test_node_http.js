#!/usr/bin/env node
/**
 * Test Node.js HTTP client independently
 */
const http = require('http');

console.log('Testing HTTP POST to 127.0.0.1:5678...\n');

const postData = JSON.stringify({ message: 'test from node' });

const options = {
  hostname: '127.0.0.1',
  port: 5678,
  path: '/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Connection': 'keep-alive'
  },
  timeout: 5000
};

console.log('Request options:', JSON.stringify(options, null, 2));
console.log('POST data:', postData);
console.log('\nSending request...\n');

const req = http.request(options, (res) => {
  console.log(`Response status: ${res.statusCode}`);
  console.log(`Response headers:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    console.log(`Received chunk: ${chunk.length} bytes`);
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`\nResponse complete. Total: ${data.length} bytes`);
    console.log('Response body:', data);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
  console.error('Error code:', err.code);
  console.error('Error message:', err.message);
});

req.on('socket', (socket) => {
  console.log('Socket assigned');
  
  socket.on('connect', () => {
    console.log('Socket connected');
  });
  
  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
  
  socket.on('close', () => {
    console.log('Socket closed');
  });
  
  socket.on('timeout', () => {
    console.log('Socket timeout');
  });
});

console.log('Writing request body...');
req.write(postData);
console.log('Ending request...');
req.end();
console.log('Request sent. Waiting for response...\n');

