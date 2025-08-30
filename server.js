// server.js
const express = require('express');
const { execSync } = require('child_process');
const app = express();
const port = 3000;

// Function to get latest commit hash
function getLatestCommit() {
  try {
    return execSync('git log -1 --oneline').toString().trim();
  } catch (err) {
    return 'N/A';
  }
}

// Function to get deployment timestamp
function getDeployTime() {
  return new Date().toISOString();
}

app.get('/', (req, res) => {
  const commit = getLatestCommit();
  const timestamp = getDeployTime();

  res.send(`
    <h1>Central Print Server</h1>
    <p>✅ Server is running!</p>
    <p>Latest commit: <strong>${commit}</strong></p>
    <p>Deployed at: <strong>${timestamp}</strong></p>
  `);
});

app.listen(port, () => {
  console.log(`Central Print Server running at http://localhost:${port}`);
});
