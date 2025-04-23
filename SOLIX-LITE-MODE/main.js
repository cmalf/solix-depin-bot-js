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

const fs = require("fs");
const axios = require("axios");
const yaml = require("js-yaml");
const readline = require("readline");
const path = require("path");
const {
    Colors,
    CoderMark,
    ProxyError,
    loadProxies,
    getNextProxy,
    createProxyAgent,
    maskEmail,
    UnauthorizedError,
} = require("./utils");

// --- Constants ---
const ACCOUNTS_FILE = "./accounts.yaml";
const DATA_FILE = "./data.yaml";
const PROXY_FILE = "./proxy.txt";

const LOGIN_URL = "https://api.solixdepin.net/api/auth/login-password";
const TOTAL_POINT_URL = "https://api.solixdepin.net/api/point/get-total-point";
const CONNECTION_QUALITY_URL = "https://api.solixdepin.net/api/point/get-connection-quality";

const LOGIN_INTERVAL_MS = 3590 * 1000; // Approx 1 hour (slightly less to avoid overlap)
const CQ_FETCH_INTERVAL_MS = 15 * 1000; // 15 seconds
const TOTAL_POINT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const MAX_RETRIES = 5; // Max retries for network requests
const RETRY_DELAY_MS = 15 * 1000; // 15 seconds delay between retries
const PROXY_RETRY_DELAY_MS = 500; // Short delay when retrying with the next proxy
const RATE_LIMIT_DELAY_MS = 3 * RETRY_DELAY_MS; // Longer delay for 429 errors
const REQUEST_TIMEOUT_MS = 60 * 1000; // 60 seconds timeout for requests

// --- Globals ---
let accountCredentials = []; // Stores { email, password } from accounts.yaml
let accountDataStore = { accounts: [] }; // Stores { email, accessToken, refreshToken } from data.yaml
let proxies = []; // Stores loaded proxies
let currentProxyIndex = 0; // Tracks the current proxy index for round-robin

// --- Utility Functions ---

function prompt(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function loadYamlFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`${Colors.Yellow}Warning: File not found: ${filePath}. Returning default structure.${Colors.RESET}`);
            // Return default structure based on file type
            if (filePath === DATA_FILE || filePath === ACCOUNTS_FILE) {
                return { accounts: [] };
            }
            return null;
        }
        const fileContent = fs.readFileSync(filePath, "utf8");
        return yaml.load(fileContent);
    } catch (error) {
        console.error(`${Colors.Red}Error loading YAML file ${filePath}: ${error.message}${Colors.RESET}`);
        // Return default structure on error
        if (filePath === DATA_FILE || filePath === ACCOUNTS_FILE) {
            return { accounts: [] };
        }
        return null;
    }
}

function saveYamlFile(filePath, data) {
    try {
        const yamlString = yaml.dump(data);
        fs.writeFileSync(filePath, yamlString, "utf8");
    } catch (error) {
        console.error(`${Colors.Red}Error saving YAML file ${filePath}: ${error.message}${Colors.RESET}`);
    }
}

// --- Core Logic ---

async function makeRequestWithRetry(
    options,
    proxyList,
    emailForLog = "N/A",
    maxRetries = MAX_RETRIES,
    retryDelay = RETRY_DELAY_MS
) {
    let attempt = 0;
    let lastError = null;
    const randomUseragent = require("random-user-agent");
    let userAgent = randomUseragent("desktop", "chrome", "linux");
    const logPrefix = `[${maskEmail(emailForLog)}]`;

    while (attempt < maxRetries) {
        const proxy = getNextProxy(proxyList); // Get proxy for this attempt
        let agent;
        const currentOptions = { ...options }; // Clone options for modification

        try {
            // Configure proxy agent if a proxy is available
            if (proxy) {
                agent = await createProxyAgent(proxy);
                currentOptions.httpsAgent = agent;
                currentOptions.httpAgent = agent;
                currentOptions.proxy = false;
            } else {
                // Ensure no agent is used if no proxy is selected
                currentOptions.httpsAgent = undefined;
                currentOptions.httpAgent = undefined;
                currentOptions.proxy = undefined;
            }

            // Set common headers and timeout
            currentOptions.headers = {
                accept: "application/json, text/plain, */*",
                "accept-language": "en-US,en;q=0.9",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "cross-site",
                "user-agent": userAgent,
                ...currentOptions.headers, // Allow overriding defaults
            };
            currentOptions.timeout = REQUEST_TIMEOUT_MS;

            // Make the request
            const response = await axios(currentOptions);
            return response; // Success

        } catch (error) {
            lastError = error;
            let shouldRetry = false;
            let currentDelay = retryDelay;

            if (error instanceof ProxyError) {
                // Specific error from createProxyAgent or proxy connection issue
                console.error(`${Colors.Yellow}${logPrefix} Proxy error with ${error.proxy || proxy}: ${error.message}. Trying next proxy.${Colors.RESET}`);
                // Short delay before trying the next proxy
                await new Promise(resolve => setTimeout(resolve, PROXY_RETRY_DELAY_MS));
                continue; // Immediately try next proxy/attempt without incrementing attempt count in the same way
            }

            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const errorCode = error.code;
                const errorMessage = error.message?.toLowerCase() || "";

                if (status === 401) {
                    // Not retryable, specific handling needed
                    throw new UnauthorizedError(`Unauthorized (401) for ${options.url}`, status);
                } else if (status === 429) {
                    // Rate limited
                    console.warn(`${Colors.Yellow}${logPrefix} Rate limited (429). Retrying after a longer delay...${Colors.RESET}`);
                    shouldRetry = true;
                    currentDelay = RATE_LIMIT_DELAY_MS;
                } else if (
                    status >= 500 || // Server errors
                    errorCode === 'ECONNABORTED' || // Timeout
                    errorCode === 'ECONNRESET' || // Connection reset
                    errorCode === 'ETIMEDOUT' || // Timeout
                    errorCode === 'ENOTFOUND' || // DNS lookup failed
                    errorCode === 'EAI_AGAIN' || // DNS lookup temporary failure
                    errorMessage.includes("stream has been aborted") // Specific network error (add yourself if needed)
                ) {
                    // Retryable server/network errors
                    console.warn(`${Colors.Neon}${logPrefix} ${Colors.Yellow}Retryable error (Status: ${status}, Code: ${Colors.Neon}${errorCode}${Colors.Yellow}, Msg: ${Colors.Red}${error.message}${Colors.Yellow}). Retrying...${Colors.RESET}`);
                    shouldRetry = true;
                } else {
                    // Non-retryable client errors (e.g., 400, 403, 404)
                    console.error(`${Colors.Red}${logPrefix} Non-retryable client error ${status}: ${error.message}${Colors.RESET}`);
                    throw error; // Re-throw non-retryable client errors
                }
            } else {
                // Non-Axios errors (e.g., programming errors, unexpected issues)
                // Check for specific retryable messages here too
                 if (error.message?.includes("logPrefix is not defined")) {
                     // This specific error seems like a bug elsewhere, but let's retry defensively
                     console.warn(`${Colors.Yellow}${logPrefix} Encountered specific error '${error.message}'. Retrying (Attempt ${attempt + 1}/${maxRetries})...${Colors.RESET}`);
                     shouldRetry = true;
                 } else {
                    console.error(`${Colors.Red}${logPrefix} Non-Axios Error (Attempt ${attempt + 1}/${maxRetries}): ${error.message}${Colors.RESET}`);
                    shouldRetry = true; // Retry generic non-axios errors cautiously
                 }
            }

            if (!shouldRetry) {
                break; // Exit loop if error is not retryable
            }

            attempt++;
            if (attempt < maxRetries) {
                console.log(`${Colors.Yellow}${logPrefix} Retrying attempt ${attempt + 1}/${maxRetries} after ${currentDelay / 1000}s...${Colors.RESET}`);
                await new Promise(resolve => setTimeout(resolve, currentDelay));
                // Consider rotating user-agent on retries if needed
                // userAgent = randomUseragent("desktop", "chrome", "linux");
            }
        }
    }

    // If loop finishes without success
    console.error(`${Colors.Red}${logPrefix} Request failed permanently after ${maxRetries} retries for ${options.url}.${Colors.RESET}`);
    throw lastError || new Error(`${logPrefix} Request failed after maximum retries for ${options.url}.`);
}

async function loginAccount(account) {
    const { email, password } = account;
    const maskedEmail = maskEmail(email);
    const logPrefix = `[${maskedEmail}]`;
    console.log(`${Colors.RESET}${logPrefix} ${Colors.Yellow}Attempting login...${Colors.RESET}`);

    const options = {
        method: "POST",
        url: LOGIN_URL,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
            email: email,
            password: password,
            referralByCode: "",
            captchaToken: "",
        }),
    };

    try {
        // Use makeRequestWithRetry for the login attempt
        const response = await makeRequestWithRetry(options, proxies, email);

        if (response.data && response.data.result === "success" && response.data.data?.accessToken && response.data.data?.refreshToken) {
            const { accessToken, refreshToken } = response.data.data;
            console.log(`${Colors.RESET}${logPrefix} ${Colors.Green}Login successful.${Colors.RESET}`);
            return { email, accessToken, refreshToken };
        } else {
            // Handle cases where the request succeeded but the API indicated login failure
            console.error(`${Colors.Red}${logPrefix} Login failed: Unexpected API response format or failure result.${Colors.RESET}`, response.data);
            return null;
        }
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            // Specifically handle 401 Unauthorized during login
            console.error(`${Colors.Red}${logPrefix} Login failed: Invalid credentials (401).${Colors.RESET}`);
            // No need to call handleUnauthorized here, as there are no tokens to clear yet.
        } else {
            // Handle errors after retries from makeRequestWithRetry
            console.error(`${Colors.Red}${logPrefix} Login attempt failed after retries: ${error.message}${Colors.RESET}`);
        }
        return null; // Indicate login failure
    }
}

function handleUnauthorized(email) {
    const maskedEmail = maskEmail(email);
    const logPrefix = `[${maskedEmail}]`;
    console.error(`${Colors.Red}${logPrefix} Unauthorized (401). Token likely expired or invalid. Clearing tokens and scheduling re-login.${Colors.RESET}`);

    const accountIndex = accountDataStore.accounts.findIndex(acc => acc.email === email);
    if (accountIndex > -1) {
        // Check if tokens actually exist before clearing and saving
        if (accountDataStore.accounts[accountIndex].accessToken || accountDataStore.accounts[accountIndex].refreshToken) {
            accountDataStore.accounts[accountIndex].accessToken = null;
            accountDataStore.accounts[accountIndex].refreshToken = null;
            console.log(`${Colors.Yellow}${logPrefix} Tokens cleared in data store.${Colors.RESET}`);
            saveYamlFile(DATA_FILE, accountDataStore); // Save changes immediately
        } else {
             console.log(`${Colors.Dim}${logPrefix} No tokens found to clear.${Colors.RESET}`);
        }
    } else {
        console.warn(`${Colors.Yellow}${logPrefix} Account not found in data store during unauthorized handling.${Colors.RESET}`);
    }
    // The account will be picked up in the next login cycle if needed
}

async function fetchConnectionQualityOnly(accountData) {
    const { email, accessToken } = accountData;
    const maskedEmail = maskEmail(email);
    const logPrefix = `[${maskedEmail}]`;

    if (!accessToken) {
        // console.log(`${Colors.Dim}${logPrefix} Skipping CQ fetch: No access token.${Colors.RESET}`);
        return null; // Cannot fetch without a token
    }

    const options = {
        method: "GET",
        url: CONNECTION_QUALITY_URL,
        headers: { authorization: `Bearer ${accessToken}` },
    };

    try {
        const response = await makeRequestWithRetry(options, proxies, email);
        const connectionQuality = response.data?.data ?? "N/A"; // Use nullish coalescing
        console.log(`${logPrefix}${Colors.RESET} : ${Colors.Gold}CQ: ${connectionQuality}${Colors.RESET}`);
        return { connectionQuality };
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            handleUnauthorized(email); // Handle token expiration/invalidation
        } else {
            console.error(`${Colors.Red}${logPrefix} CQ fetch failed: ${error.message}${Colors.RESET}`);
        }
        return null; // Indicate failure
    }
}

async function fetchFullAccountData(accountData) {
    const { email, accessToken } = accountData;
    const maskedEmail = maskEmail(email);
    const logPrefix = `[${maskedEmail}]`;

    if (!accessToken) {
        // console.log(`${Colors.Dim}${logPrefix} Skipping full data fetch: No access token.${Colors.RESET}`);
        return null; // Cannot fetch without a token
    }

    const headers = { authorization: `Bearer ${accessToken}` };

    try {
        // Fetch Total Points
        const totalPointsOptions = { method: "GET", url: TOTAL_POINT_URL, headers };
        const pointsResponse = await makeRequestWithRetry(totalPointsOptions, proxies, email);
        const totalPoints = pointsResponse.data?.data?.total ?? "N/A";

        // Fetch Connection Quality
        const cqOptions = { method: "GET", url: CONNECTION_QUALITY_URL, headers };
        const cqResponse = await makeRequestWithRetry(cqOptions, proxies, email);
        const connectionQuality = cqResponse.data?.data ?? "N/A";

        console.log(`${logPrefix}${Colors.RESET} : ${Colors.Blue}Total Points: ${Colors.Neon}${totalPoints}${Colors.RESET} | ${Colors.Gold}CQ: ${connectionQuality}${Colors.RESET}`);
        return { totalPoints, connectionQuality };

    } catch (error) {
        if (error instanceof UnauthorizedError) {
            handleUnauthorized(email); // Handle token expiration/invalidation
        } else {
            console.error(`${Colors.Red}${logPrefix} Full data fetch failed: ${error.message}${Colors.RESET}`);
        }
        return null; // Indicate failure
    }
}

async function runLoginCycle(emailsToLogin = null) {
    console.log(`\n${Colors.Teal}--- Starting Login Cycle ---${Colors.RESET}`);

    // Determine which accounts need login attempts
    let accountsToProcess;
    if (emailsToLogin) {
        // Filter credentials based on the provided email list
        accountsToProcess = accountCredentials.filter(cred => emailsToLogin.includes(cred.email));
        console.log(`${Colors.RESET}Attempting login for ${Colors.Neon}${accountsToProcess.length}${Colors.RESET} specific account(s)...`);
    } else {
        // Attempt login for all accounts defined in credentials
        accountsToProcess = [...accountCredentials];
        console.log(`${Colors.RESET}Attempting login for all ${Colors.Neon}${accountsToProcess.length}${Colors.RESET} configured account(s)...`);
    }


    if (accountsToProcess.length === 0) {
        console.log(`${Colors.Yellow}No accounts require login in this cycle.${Colors.RESET}`);
        return;
    }

    // Create login promises for each account
    const loginPromises = accountsToProcess.map(account => loginAccount(account));

    // Wait for all login attempts to settle (succeed or fail)
    const results = await Promise.allSettled(loginPromises);

    let dataStoreUpdated = false;
    results.forEach((result, index) => {
        const email = accountsToProcess[index].email; // Get email corresponding to the result
        const maskedEmail = maskEmail(email);
        const logPrefix = `[${maskedEmail}]`;

        if (result.status === "fulfilled" && result.value) {
            // Login was successful, result.value contains { email, accessToken, refreshToken }
            const { accessToken, refreshToken } = result.value;
            const accountIndex = accountDataStore.accounts.findIndex(acc => acc.email === email);

            if (accountIndex > -1) {
                // Update existing account data if tokens changed
                if (accountDataStore.accounts[accountIndex].accessToken !== accessToken ||
                    accountDataStore.accounts[accountIndex].refreshToken !== refreshToken)
                {
                    accountDataStore.accounts[accountIndex].accessToken = accessToken;
                    accountDataStore.accounts[accountIndex].refreshToken = refreshToken;
                    console.log(`${Colors.RESET}${logPrefix} ${Colors.Blue}Tokens updated in data store.${Colors.RESET}`);
                    dataStoreUpdated = true;
                } else {
                     console.log(`${Colors.Dim}${logPrefix} Tokens remain unchanged.${Colors.RESET}`);
                }
            } else {
                // This case should ideally not happen if initialization is correct, but handle defensively
                console.warn(`${Colors.Yellow}${logPrefix} Account not found in data store during login update. Adding.${Colors.RESET}`);
                accountDataStore.accounts.push({ email, accessToken, refreshToken });
                dataStoreUpdated = true;
            }
        } else {
            // Login failed (either API error, network error after retries, or 401)
            // Error messages are already logged within loginAccount or makeRequestWithRetry
            console.warn(`${Colors.Yellow}${logPrefix} Login cycle: Account login failed (see previous errors).${Colors.RESET}`);
            // If the failure was 401, tokens might have been cleared by handleUnauthorized already.
            // If it was another error, tokens remain as they were (potentially null or old).
            // The account will be retried in the next scheduled login cycle.
        }
    });

    // Save the data file if any tokens were updated or added
    if (dataStoreUpdated) {
        console.log(`${Colors.Gold}Updating data file after login cycle: ${DATA_FILE}${Colors.RESET}`);
        saveYamlFile(DATA_FILE, accountDataStore);
    }

    console.log(`${Colors.Gold}[+] ${Colors.RESET}Login Cycle Finished ${Colors.RESET}`);
}


async function runCQFetchCycle() {
    // console.log(`\n${Colors.Dim}--- Starting CQ Fetch Cycle ---${Colors.RESET}`); // Optional: More verbose logging
    if (!accountDataStore || !accountDataStore.accounts || accountDataStore.accounts.length === 0) {
        console.log(`${Colors.Yellow}No account data available for CQ fetch.${Colors.RESET}`);
        return;
    }

    // Sequentially fetch CQ for each account to avoid overwhelming the API/proxies
    for (const account of accountDataStore.accounts) {
        await fetchConnectionQualityOnly(account);
        await new Promise(resolve => setTimeout(resolve, 150)); // Small delay between requests
    }
    // console.log(`${Colors.Dim}--- CQ Fetch Cycle Finished ---${Colors.RESET}`); // Optional: More verbose logging
}

async function runTotalPointFetchCycle() {
    console.log(`\n${Colors.Gold}[+] ${Colors.RESET}Total Point Fetch Cycle (Every ${TOTAL_POINT_INTERVAL_MS / 60000} mins) ${Colors.RESET}\n`);
    if (!accountDataStore || !accountDataStore.accounts || accountDataStore.accounts.length === 0) {
        console.log(`${Colors.Yellow}No account data available for full data fetch.${Colors.RESET}`);
        return;
    }

    // Sequentially fetch full data for each account
    for (const account of accountDataStore.accounts) {
        await fetchFullAccountData(account);
        await new Promise(resolve => setTimeout(resolve, 200)); // Slightly larger delay
    }

    console.log(`\n${Colors.Gold}[+] ${Colors.RESET}Total Point Fetch Cycle Finished ${Colors.RESET}\n`);
}


async function initializeAndRun() {
    console.log(`${Colors.Bright}${Colors.Teal}--- Multi-Account Bot Starting ---${Colors.RESET}\n`);

    // --- Load Configuration ---
    proxies = loadProxies(PROXY_FILE); // Load proxies first

    const credentials = loadYamlFile(ACCOUNTS_FILE);
    if (!credentials || !credentials.accounts || credentials.accounts.length === 0) {
        console.error(`${Colors.Red}Error: No accounts found in ${ACCOUNTS_FILE} or file is invalid. Exiting.${Colors.RESET}`);
        process.exit(1);
    }
    accountCredentials = credentials.accounts;
    console.log(`${Colors.Teal}]> ${Colors.RESET}Loaded ${Colors.Neon}${accountCredentials.length} ${Colors.RESET}account credentials.`);

    // Load existing data or initialize
    const loadedData = loadYamlFile(DATA_FILE);
    if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.accounts)) {
        accountDataStore = loadedData;
    } else {
        console.warn(`${Colors.Yellow}Warning: Invalid or missing ${DATA_FILE}. Initializing with empty data.${Colors.RESET}`);
        accountDataStore = { accounts: [] };
    }

    // --- Synchronize Account Data ---
    const emailsNeedingLogin = [];
    const credentialEmails = new Set(accountCredentials.map(acc => acc.email));
    const dataStoreEmails = new Set(accountDataStore.accounts.map(acc => acc.email));

    // Add missing accounts from credentials to data store (with null tokens)
    accountCredentials.forEach(cred => {
        if (!dataStoreEmails.has(cred.email)) {
            console.log(`${Colors.Dim}Adding placeholder for ${maskEmail(cred.email)} to data store.${Colors.RESET}`);
            accountDataStore.accounts.push({ email: cred.email, accessToken: null, refreshToken: null });
            emailsNeedingLogin.push(cred.email); // Needs initial login
        }
    });

    // Remove accounts from data store that are no longer in credentials
    accountDataStore.accounts = accountDataStore.accounts.filter(acc => {
        if (credentialEmails.has(acc.email)) {
            return true;
        } else {
            console.log(`${Colors.Dim}Removing ${maskEmail(acc.email)} from data store (not in credentials).${Colors.RESET}`);
            return false;
        }
    });

    // Identify accounts in data store that have missing tokens
    accountDataStore.accounts.forEach(acc => {
        if (!acc.accessToken || !acc.refreshToken) {
            if (!emailsNeedingLogin.includes(acc.email)) {
                 // Ensure it's only added once
                 emailsNeedingLogin.push(acc.email);
            }
        }
    });

    console.log(`${Colors.Teal}]> ${Colors.RESET}Synchronized data store with ${Colors.Neon}${accountDataStore.accounts.length} ${Colors.RESET}accounts.`);
    saveYamlFile(DATA_FILE, accountDataStore); // Save the potentially modified data store

    // --- Initial Token Check & Login ---
    console.log(`\n${Colors.Teal}--- Performing Initial Token Check ---${Colors.RESET}\n`);
    const accountsWithTokens = accountDataStore.accounts.filter(acc => acc.accessToken && !emailsNeedingLogin.includes(acc.email));

    for (const account of accountsWithTokens) {
        const maskedEmail = maskEmail(account.email);
        const logPrefix = `[${maskedEmail}]`;
        console.log(`${Colors.Dim}${logPrefix} Checking existing token...${Colors.RESET}`);
        try {
            // Use a lightweight request like CQ fetch to validate the token
            const cqResult = await fetchConnectionQualityOnly(account);
            if (cqResult === null && !emailsNeedingLogin.includes(account.email)) {
                // fetchConnectionQualityOnly returns null on error (including 401 handled internally)
                // If handleUnauthorized was called, tokens are already null.
                // If it was another error, we should probably try logging in again.
                console.warn(`${Colors.Yellow}${logPrefix} Token check failed (likely invalid/expired or network issue). Scheduling re-login.${Colors.RESET}`);
                emailsNeedingLogin.push(account.email);
            } else if (cqResult !== null) {
                console.log(`${Colors.RESET}${logPrefix} ${Colors.Teal}]> ${Colors.Neon}Existing token is valid.${Colors.RESET}`);
            }
        } catch (error) {
            // Catch errors not handled within fetchConnectionQualityOnly (should be rare)
            console.error(`${Colors.Red}${logPrefix} Error during initial token check: ${error.message}${Colors.RESET}`);
             if (error instanceof UnauthorizedError) {
                 // handleUnauthorized should have been called inside fetch, but double-check
                 handleUnauthorized(account.email);
                 if (!emailsNeedingLogin.includes(account.email)) emailsNeedingLogin.push(account.email);
             } else {
                 // For other errors, schedule a login attempt
                 if (!emailsNeedingLogin.includes(account.email)) emailsNeedingLogin.push(account.email);
             }
        }
        await new Promise(resolve => setTimeout(resolve, 150)); // Delay between checks
    }
    console.log(`\n${Colors.Gold}[+] ${Colors.RESET}Initial Token Check Finished ${Colors.RESET}\n`);

    // Perform initial login for accounts identified as needing it
    if (emailsNeedingLogin.length > 0) {
        console.log(`${Colors.Yellow}Accounts needing initial login or token refresh: ${emailsNeedingLogin.length}${Colors.RESET}`);
        await runLoginCycle(emailsNeedingLogin); // Pass the specific list
    } else {
        console.log(`${Colors.Teal}]> ${Colors.Green}All accounts have valid tokens initially.${Colors.RESET}`);
    }

    // --- Initial Data Fetch ---
    console.log(`\n${Colors.Teal}--- Performing Initial Full Data Fetch ---${Colors.RESET}`);
    await runTotalPointFetchCycle(); // Fetch points/CQ for all accounts with valid tokens

    // --- Start Schedulers ---
    console.log(`\n${Colors.Teal}--- Starting Schedulers ---${Colors.RESET}\n`);

    // CQ Fetch Scheduler
    console.log(`${Colors.RESET}Starting CQ fetch scheduler ${Colors.Gold}(Interval: ${CQ_FETCH_INTERVAL_MS / 1000} seconds)${Colors.RESET}`);
    setInterval(runCQFetchCycle, CQ_FETCH_INTERVAL_MS);

    // Total Point Fetch Scheduler
    console.log(`${Colors.RESET}Starting Total Point fetch scheduler ${Colors.Gold}(Interval: ${TOTAL_POINT_INTERVAL_MS / 1000 / 60} minutes)${Colors.RESET}`);
    setInterval(runTotalPointFetchCycle, TOTAL_POINT_INTERVAL_MS);

    // Periodic Login Refresh Scheduler (attempts login for all accounts)
    // This ensures tokens are refreshed before expiry and handles accounts that failed previously
    console.log(`${Colors.RESET}Starting periodic login refresh scheduler ${Colors.Gold}(Interval: ${LOGIN_INTERVAL_MS / 1000 / 60} minutes)${Colors.RESET}`);
    setInterval(() => {
        // Run login for all accounts defined in credentials.
        // runLoginCycle will internally check/update tokens in the data store.
        runLoginCycle();
    }, LOGIN_INTERVAL_MS);

    console.log(`\n${Colors.Bright}${Colors.Neon}--- Bot Initialized and Running ---${Colors.RESET}\n`);
}

async function main() {
    console.clear();
    CoderMark(); // Display coder mark/banner
    console.log(`\n${Colors.Gold}Menu:${Colors.RESET}\n`);
    console.log(`${Colors.Gold}1. ${Colors.RESET}Run Mining Points`);
    console.log(`${Colors.Gold}2. ${Colors.Red}Exit${Colors.RESET}\n`);

    const choice = await prompt(`${Colors.RESET}Enter your choice (1 or 2): `);

    if (choice === "1") {
        console.clear();
        await initializeAndRun(); // Start the main application logic
    } else if (choice === "2") {
        console.clear();
        CoderMark();
        console.log(`${Colors.Red}Exiting the application. Goodbye!${Colors.RESET}`);
        process.exit(0);
    } else {
        console.log(Colors.Red + "Invalid choice. Exiting." + Colors.RESET);
        process.exit(1);
    }
}

// --- Entry Point ---
main().catch((error) => {
    console.error(`${Colors.Red}${Colors.Bright}FATAL ERROR: ${error.message}${Colors.RESET}`, error);
    process.exit(1);
});
