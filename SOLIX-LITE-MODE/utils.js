"use strict";

/**
########################################################
#                                                      #
#   CODE  : SOLIX DEPIN LITE MODE Bot v1.0.3           #
#   NodeJs: v23.10.0                                   #
#   Author: CMALF                                      #
#   TG    : https://t.me/djagocuan                     #
#   GH    : https://github.com/cmalf                   #
#                                                      #
########################################################
*/
/**
 * This code is open-source and welcomes contributions! 
 * 
 * If you'd like to add features or improve this code, please follow these steps:
 * 1. Fork this repository to your own GitHub account.
 * 2. Make your changes in your forked repository.
 * 3. Submit a pull request to the original repository. 
 * 
 * This allows me to review your contributions and ensure the codebase maintains high quality. 
 * 
 * Let's work together to improve this project!
 * 
 * P.S. Remember to always respect the original author's work and avoid plagiarism. 
 * Let's build a community of ethical and collaborative developers.
 */

const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Color definitions
const Colors = {
  Green: "\x1b[32m",
  Red: "\x1b[31m",
  Bright: "\x1b[1m",
  Dim: "\x1b[2m",
  Purple: "\x1b[35m",
  Yellow: "\x1b[33m",
  Magenta: "\x1b[95m",
  Cyan: "\x1b[36m",
  Magenta2: "\x1b[91m",
  Blue: "\x1b[34m",
  Rainbow: "\x1b[38;5;206m",
  Gold: "\x1b[38;5;220m",
  Teal: "\x1b[38;5;51m",
  Orange: "\x1b[38;5;208m",
  Neon: "\x1b[38;5;198m",
  Electric: "\x1b[38;5;123m",
  RESET: "\x1b[0m"
};

function CoderMark() {
  try {
    console.log(`
    
 ______     __    __     ______     __         ______  
/\\  ___\\   /\\ "-./  \\   /\\  __ \\   /\\ \\       /\\  ___\\ ${Colors.Green}
\\ \\ \\____  \\ \\ \\-./\\ \\  \\ \\  __ \\  \\ \\ \\____  \\ \\  __\\ 
 \\ \\_____\\  \\ \\_\\ \\ \\_\\  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ ${Colors.Blue}  
  \\/_____/   \\/_/  \\/_/   \\/_/\\/_/   \\/_____/   \\/_/   ${Colors.Blue}${Colors.RESET}
                                                        
  
${Colors.Gold}[+] ${Colors.RESET}SOLIX-LITE-MODE BOT ${Colors.Green}JS ${Colors.RESET} 
  
${Colors.Green}${"-".repeat(55)}
  
${Colors.Gold}[+]${Colors.RESET} DM : ${Colors.Teal}https://t.me/Djagocuan
  
${Colors.Gold}[+]${Colors.RESET} GH : ${Colors.Teal}https://github.com/cmalf/
    
${Colors.Green}${"-".repeat(55)}${Colors.RESET}
    `);
  } catch (error) {
    console.error("An error occurred while logging the banner:", error);
  }
}

// --- Custom Errors ---
class ProxyError extends Error {
  constructor(message, proxy) {
    super(message);
    this.name = "ProxyError";
    this.proxy = proxy;
  }
}

class UnauthorizedError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "UnauthorizedError";
    this.statusCode = statusCode;
  }
}

// --- Helper Functions ---
const maskEmail = (email) => {
  if (typeof email !== 'string') {
    // Return as is or throw error, returning seems safer for logging
    return email || 'invalid_email';
  }
  const parts = email.split('@');
  if (parts.length !== 2) {
    return email; // Invalid format
  }
  const [username, domain] = parts;
  if (username.length < 4) {
    return email; // Too short to mask meaningfully
  }
  const maskedUsername = username.slice(0, 2) + ':::' + username.slice(-2);
  return `${maskedUsername}@${domain}`;
};

function loadProxies(proxyFilePath) {
  try {
    if (!fs.existsSync(proxyFilePath)) {
        console.warn(`${Colors.Yellow}Warning: Proxy file not found: ${proxyFilePath}. Proceeding without proxies.${Colors.RESET}`);
        return [];
    }
    const lines = fs
      .readFileSync(proxyFilePath, "utf8")
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && line.length > 0);
    if (lines.length === 0) {
        console.warn(`${Colors.Yellow}Warning: Proxy file is empty or contains no valid proxies.${Colors.RESET}`);
    }
    console.log(`${Colors.Teal}]> ${Colors.RESET}Loaded ${Colors.Neon}${lines.length} ${Colors.RESET}proxies.`);
    return lines;
  } catch (err) {
    console.error(`${Colors.Red}Error loading proxies: ${err.message}${Colors.RESET}`);
    return [];
  }
}

let currentProxyIndex = 0;
function getNextProxy(proxyList) {
  if (!proxyList || proxyList.length === 0) {
    return null;
  }
  const proxy = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  return proxy;
}

async function createProxyAgent(proxyUrl) {
  if (!proxyUrl) throw new ProxyError("Proxy URL is required", proxyUrl);
  try {
    const lowerCaseUrl = proxyUrl.toLowerCase();
    if (lowerCaseUrl.startsWith("http://") || lowerCaseUrl.startsWith("https://"))
      return new HttpsProxyAgent(proxyUrl);
    if (lowerCaseUrl.startsWith("socks://") || lowerCaseUrl.startsWith("socks5://"))
      return new SocksProxyAgent(proxyUrl);
    if (lowerCaseUrl.includes('@') && (lowerCaseUrl.startsWith('http') || lowerCaseUrl.startsWith('socks'))) {
        return lowerCaseUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    }
    throw new ProxyError(`Unsupported proxy protocol or format: ${proxyUrl}`, proxyUrl);
  } catch (err) {
    if (err instanceof ProxyError) throw err;
    throw new ProxyError(`Failed to create proxy agent for ${proxyUrl}: ${err.message}`, proxyUrl);
  }
}

module.exports = {
  Colors,
  CoderMark,
  ProxyError,
  loadProxies,
  getNextProxy,
  createProxyAgent,
  maskEmail,
  UnauthorizedError
};