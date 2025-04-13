"use strict";

/**
########################################################
#                                                      #
#   CODE  : SOLIX DEPIN Bot v1.0.0                     #
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
const readline = require("readline");
const path = require("path");
const {
  Colors,
  CoderMark,
  ProxyError,
  requestWithRetry,
  loadProxies,
  getRandomProxy,
  createProxyAgent,
  maskEmail,
  UnauthorizedError
} = require("./utils");

const PROXY_FILE = "./proxy.txt";
const COMMON_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language":
    "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7,zh-TW;q=0.6,zh;q=0.5"
};

// Global loginData to be used for clearing intervals on exit
let globalLoginData = [];


function createAxiosInstance(accessToken, agent) {
  const config = {
    baseURL: "https://api.solixdepin.net/api",
    headers: { ...COMMON_HEADERS },
    timeout: 60000 // 60 seconds timeout
  };

  if (accessToken) {
    config.headers["authorization"] = `Bearer ${accessToken}`;
  }

  if (agent) {
    config.proxy = false;
    config.httpAgent = agent;
    config.httpsAgent = agent;
  }

  return axios.create(config);
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadAccounts() {
  const accountsPath = path.join(__dirname, "accounts.txt");
  if (!fs.existsSync(accountsPath)) {
    console.error(
      Colors.Red +
        "accounts.txt file not found. Please create the file with account credentials." +
        Colors.RESET
    );
    process.exit(1);
  }
  let data;
  try {
    data = fs.readFileSync(accountsPath, "utf8");
  } catch (err) {
    console.error(
      Colors.Red + "Error reading accounts.txt: " + err.message + Colors.RESET
    );
    process.exit(1);
  }
  const lines = data.split(/\r?\n/).filter((line) => line && line.includes(":"));
  return lines.map((line) => {
    const [email, password] = line.split(":");
    return { email: email.trim(), password: password.trim() };
  });
}

function saveLoginData(loginData) {
  try {
    fs.writeFileSync(
      path.join(__dirname, "DataAccount.json"),
      JSON.stringify(loginData, null, 2)
    );
  } catch (err) {
    console.error(
      Colors.Red +
        "Error saving DataAccount.json: " +
        err.message +
        Colors.RESET
    );
  }
}

function loadLoginData() {
  const dataPath = path.join(__dirname, "DataAccount.json");
  if (fs.existsSync(dataPath)) {
    try {
      const raw = fs.readFileSync(dataPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      console.error(
        Colors.Red + "Error reading DataAccount.json: " + error.message + Colors.RESET
      );
      return null;
    }
  }
  return null;
}

async function login(instance, account) {
  try {
    const response = await requestWithRetry(
      () =>
        instance.post(
          "/auth/login-password",
          {
            email: account.email,
            password: account.password
          },
          {
            headers: { "content-type": "application/json" }
          }
        ),
      `login for ${account.email}`
    );
    if (response.data && response.data.result === "success") {
      return response.data.data;
    } else {
      console.error(
        Colors.Red +
          "Login failed for: " +
          account.email +
          Colors.RESET
      );
      return null;
    }
  } catch (error) {
    console.error(
      Colors.Red +
        "Error during login for " +
        account.email +
        ": " +
        error.message +
        Colors.RESET
    );
    return null;
  }
}

async function getConnectionQuality(instance) {
  const response = await requestWithRetry(
    () => instance.get("/point/get-connection-quality"),
    `${Colors.RESET}get Connection Quality`
  );
  return response.data.data;
}

async function getProfile(instance) {
  const response = await requestWithRetry(
    () => instance.get("/auth/profile"),
    `${Colors.RESET}get Profile`
  );
  return response.data.data;
}

async function getTotalPoint(instance) {
  const response = await requestWithRetry(
    () => instance.get("/point/get-total-point"),
    `${Colors.RESET}get Total Point`
  );
  return response.data.data;
}

async function getUserTask(instance) {
  const response = await requestWithRetry(
    () => instance.get("/task/get-user-task"),
    `${Colors.RESET}get User Task`
  );
  return response.data.data;
}

async function doTask(instance, taskId) {
  const response = await requestWithRetry(
    () =>
      instance.post(
        "/task/do-task",
        { taskId },
        {
          headers: { "content-type": "application/json" }
        }
      ),
    `do task ${taskId}`
  );
  return response.data;
}

async function claimTask(instance, taskId) {
  const response = await requestWithRetry(
    () =>
      instance.post(
        "/task/claim-task",
        { taskId },
        {
          headers: { "content-type": "application/json" }
        }
      ),
    `claim task ${taskId}`
  );
  return response.data;
}

async function reLogin(accounts, agent) {
  const loginData = [];
  const delayMilliseconds = 5000; // Delay of 5 seconds between logins

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const maskedEmail = maskEmail(account.email);
    console.log(
      `${Colors.Teal}]> ${Colors.Yellow}Attempting re-login for ${Colors.Blue}${maskedEmail}... ${Colors.RESET}`
    );

    const tempInstance = createAxiosInstance(null, agent);
    const data = await login(tempInstance, account);

    if (data && data.accessToken) {
      loginData.push({
        email: account.email,
        userId: data.user ? data.user._id : "unknown",
        accessToken: data.accessToken
      });
      console.log(
        `${Colors.Teal}]> ${Colors.Green}Re-login successful for ${Colors.Blue}${maskedEmail}${Colors.RESET}`
      );
    } else {
      console.error(
        `${Colors.Teal}]> ${Colors.Red}Re-login failed for ${Colors.Blue}${maskedEmail}${Colors.RESET}`
      );
    }

    if (i < accounts.length - 1) {
      console.log(
        `${Colors.Teal}]> ${Colors.Gold}Waiting for ${delayMilliseconds / 1000} seconds before the next login...${Colors.RESET}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    }
  }
  saveLoginData(loginData);
  return loginData;
}

async function runMiningPoints(accountData, agent, allAccounts) {
  const masked = maskEmail(accountData.email);
  console.log(
    `\n${Colors.Teal}]> ${Colors.Gold}Processing Account: ${Colors.Blue}${masked}${Colors.RESET}`
  );
  const instance = createAxiosInstance(accountData.accessToken, agent);

  try {
    console.log(
      `${Colors.Teal}]> ${Colors.RESET}Login Status: ${Colors.Green}Logged In${Colors.RESET}`
    );

    const profile = await getProfile(instance);
    if (!profile) {
      console.error(
        Colors.Red + "Failed to fetch profile for: " + masked + Colors.RESET
      );
      return;
    }

    const earningColor = profile.isEarning ? Colors.Green : Colors.Red;
    console.log(
      `${Colors.Teal}]> ${Colors.Blue}${masked} ${Colors.RESET}isEarning: ${earningColor}${profile.isEarning}${Colors.RESET}`
    );

    const initialTotalPointData = await getTotalPoint(instance);
    if (initialTotalPointData) {
      console.log(`${Colors.Teal}]> ${Colors.Blue}${masked} ${Colors.RESET}Points:`);
      console.log(
        `${Colors.Gold}[+] ${Colors.RESET}totalPoint : ${Colors.Cyan}${initialTotalPointData.total}${Colors.RESET}`
      );
      console.log(
        `${Colors.Gold}[+] ${Colors.RESET}totalPointInternet : ${Colors.Cyan}${initialTotalPointData.totalPointInternet}${Colors.RESET}`
      );
      console.log(
        `${Colors.Gold}[+] ${Colors.RESET}totalPointTask : ${Colors.Cyan}${initialTotalPointData.totalPointTask}${Colors.RESET}`
      );
      console.log(
        `${Colors.Gold}[+] ${Colors.RESET}totalReferralPoint : ${Colors.Cyan}${initialTotalPointData.totalReferralPoint}${Colors.RESET}`
      );
    }

    const initialCQ = await getConnectionQuality(instance);
    if (initialCQ !== null) {
      console.log(
        `${Colors.Teal}]> ${Colors.RESET}Connection Quality: ${Colors.Teal}${initialCQ}${Colors.RESET}`
      );
    }

    const cqIntervalId = setInterval(async () => {
      try {
        const connectionQuality = await getConnectionQuality(instance);
        if (connectionQuality !== null) {
          console.log(
            `${Colors.Teal}]> ${Colors.RESET}Connection Quality ${Colors.Blue}${masked} : ${Colors.Teal}${connectionQuality}${Colors.RESET}`
          );
        }
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          console.log(
            Colors.Yellow +
              `Unauthorized error in connection quality check for ${masked}. Triggering re-login for this account.` +
              Colors.RESET
          );
          clearInterval(cqIntervalId);
          clearInterval(pointIntervalId);
          const accountInfo = allAccounts.find(
            (acc) => acc.email === accountData.email
          );
          const loggedInAccount = await reLogin([accountInfo], agent);
          if (loggedInAccount && loggedInAccount.length > 0) {
            accountData.accessToken = loggedInAccount[0].accessToken;
            console.log(
              Colors.Green +
                `Re-login successful for ${masked}. Restarting mining.` +
                Colors.RESET
            );
            runMiningPoints(accountData, agent, allAccounts);
          } else {
            console.error(
              Colors.Red +
                `Re-login failed for ${masked}. Mining will not be restarted for this account.` +
                Colors.RESET
            );
          }
        } else {
          console.error(
            Colors.Red +
              `Error during connection quality interval for ${masked}: ` +
              error.message +
              Colors.RESET
          );
        }
      }
    }, 30000);

    const pointIntervalId = setInterval(async () => {
      try {
        const totalPointData = await getTotalPoint(instance);
        if (totalPointData) {
          console.log(`\n${Colors.Teal}]> ${Colors.Blue}${masked} ${Colors.RESET}Points Update:`);
          console.log(
            `${Colors.Gold}[+] ${Colors.RESET}totalPoint : ${Colors.Cyan}${totalPointData.total}${Colors.RESET}`
          );
          console.log(
            `${Colors.Gold}[+] ${Colors.RESET}totalPointInternet : ${Colors.Cyan}${totalPointData.totalPointInternet}${Colors.RESET}`
          );
          console.log(
            `${Colors.Gold}[+] ${Colors.RESET}totalPointTask : ${Colors.Cyan}${totalPointData.totalPointTask}${Colors.RESET}`
          );
          console.log(
            `${Colors.Gold}[+] ${Colors.RESET}totalReferralPoint : ${Colors.Cyan}${totalPointData.totalReferralPoint}${Colors.RESET}`
          );
        }
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          console.log(
            Colors.Yellow +
              `Unauthorized error in point update for ${masked}. Triggering re-login for this account.` +
              Colors.RESET
          );
          clearInterval(cqIntervalId);
          clearInterval(pointIntervalId);
          const accountInfo = allAccounts.find(
            (acc) => acc.email === accountData.email
          );
          const loggedInAccount = await reLogin([accountInfo], agent);
          if (loggedInAccount && loggedInAccount.length > 0) {
            accountData.accessToken = loggedInAccount[0].accessToken;
            console.log(
              Colors.Green +
                `Re-login successful for ${masked}. Restarting mining.` +
                Colors.RESET
            );
            runMiningPoints(accountData, agent, allAccounts);
          } else {
            console.error(
              Colors.Red +
                `Re-login failed for ${masked}. Mining will not be restarted for this account.` +
                Colors.RESET
            );
          }
        } else {
          console.error(
            Colors.Red +
              `Error during point update interval for ${masked}: ` +
              error.message +
              Colors.RESET
          );
        }
      }
    }, 600000);

    // Store interval IDs for later clearance if necessary.
    accountData.cqIntervalId = cqIntervalId;
    accountData.pointIntervalId = pointIntervalId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.log(
        Colors.Yellow +
          `Unauthorized error for ${masked}. Triggering re-login for this account.` +
          Colors.RESET
      );
      if (accountData.cqIntervalId) clearInterval(accountData.cqIntervalId);
      if (accountData.pointIntervalId) clearInterval(accountData.pointIntervalId);
      const accountInfo = allAccounts.find(
        (acc) => acc.email === accountData.email
      );
      const loggedInAccount = await reLogin([accountInfo], agent);
      if (loggedInAccount && loggedInAccount.length > 0) {
        accountData.accessToken = loggedInAccount[0].accessToken;
        console.log(
          Colors.Green +
            `Re-login successful for ${masked}. Restarting mining.` +
            Colors.RESET
        );
        runMiningPoints(accountData, agent, allAccounts);
      } else {
        console.error(
          Colors.Red +
            `Re-login failed for ${masked}. Mining will not be restarted for this account.` +
            Colors.RESET
        );
      }
    } else {
      console.error(
        Colors.Red +
          `Error processing account ${masked}: ` +
          error.message +
          Colors.RESET
      );
    }
  }
}

async function completeTasks(accountData, agent) {
  const masked = maskEmail(accountData.email);
  console.log(
    `\n${Colors.Teal}]> ${Colors.Gold}Processing Tasks for Account: ${Colors.Blue}${masked}${Colors.RESET}`
  );
  const instance = createAxiosInstance(accountData.accessToken, agent);

  let tasks;
  try {
    tasks = await getUserTask(instance);
  } catch (error) {
    console.error(
      Colors.Red +
        `Error fetching tasks for ${masked}: ` +
        error.message +
        Colors.RESET
    );
    return;
  }

  if (!tasks || tasks.length === 0) {
    console.log(
      Colors.Yellow +
        "No tasks available for account: " +
        masked +
        Colors.RESET
    );
    return;
  }

  for (const task of tasks) {
    try {
      const result = await doTask(instance, task._id);
      if (result) {
        console.log(
          `${Colors.Teal}]> ${Colors.Green}Task Completed: ${task.name} (ID: ${task._id})${Colors.RESET}`
        );
        // Attempt to claim the task after successful completion
        try {
          const claimResult = await claimTask(instance, task._id);
          if (claimResult && claimResult.result === 'success') {
            console.log(
              `${Colors.Teal}]> ${Colors.Cyan}Task Claimed: ${task.name} (ID: ${task._id})${Colors.RESET}`
            );
            // You might want to log or process the claimResult further
          } else {
            console.log(
              `${Colors.Teal}]> ${Colors.Yellow}Could not claim task: ${task.name} (ID: ${task._id})${Colors.RESET}`,
              claimResult ? claimResult : '' // Log claimResult if available
            );
          }
        } catch (claimError) {
          console.error(
            Colors.Red +
              `Error claiming task ${task.name} for ${masked}: ` +
              claimError.message +
              Colors.RESET
          );
        }
      } else {
        console.log(
          `${Colors.Teal}]> ${Colors.Red}Cannot complete task: ${task.name} (ID: ${task._id})${Colors.RESET}`
        );
      }
    } catch (error) {
      console.error(
        Colors.Red +
          `Error completing task ${task.name} for ${masked}: ` +
          error.message +
          Colors.RESET
      );
    }
  }
}

function clearAllIntervals(loginData) {
  if (!Array.isArray(loginData)) return;
  for (const accountData of loginData) {
    if (accountData.cqIntervalId) {
      clearInterval(accountData.cqIntervalId);
      console.log(
        Colors.Yellow +
          `Cleared connection quality interval for ${maskEmail(accountData.email)}` +
          Colors.RESET
      );
    }
    if (accountData.pointIntervalId) {
      clearInterval(accountData.pointIntervalId);
      console.log(
        Colors.Yellow +
          `Cleared point update interval for ${maskEmail(accountData.email)}` +
          Colors.RESET
      );
    }
  }
}

async function main() {
  // Load proxy configuration and create a proxy agent if proxies exist.
  const proxyList = loadProxies(PROXY_FILE);
  let agent = null;
  if (proxyList.length > 0) {
    const selectedProxy = getRandomProxy(proxyList);
    try {
      agent = await createProxyAgent(selectedProxy);
      // Uncomment for debugging proxy usage:
      // console.log(Colors.Cyan + "Using Proxy: " + selectedProxy + Colors.RESET);
    } catch (proxyError) {
      console.error(
        Colors.Red +
          "Proxy error: " +
          proxyError.message +
          ". Proceeding without proxy." +
          Colors.RESET
      );
    }
  } else {
    console.log(
      Colors.Yellow +
        "No proxies provided in proxy.txt. Proceeding without proxy." +
        Colors.RESET
    );
  }

  const allAccounts = loadAccounts();
  let loginData = loadLoginData();

  if (loginData && Array.isArray(loginData) && loginData.length > 0) {
    const answer = await prompt(
      `\n${Colors.Teal}]> ${Colors.Neon}accessToken Already Exists, \n${Colors.Teal}]> ${Colors.RESET}Do You Want to Use It or Create a New One by Re-Login? \n${Colors.Teal}]> ${Colors.Green}Type ${Colors.Neon}> ${Colors.RESET}(use/relogin): `
    );
    if (answer.toLowerCase() === "relogin") {
      loginData = await reLogin(allAccounts, agent);
    }
  } else {
    loginData = await reLogin(allAccounts, agent);
  }
  // Update global login data for signal handlers.
  globalLoginData = loginData;

  // Display menu options.
  console.clear();
  CoderMark();
  console.log(`\n${Colors.Gold}Menu:${Colors.RESET}\n`);
  console.log(`${Colors.Gold}1. ${Colors.RESET}Run Mining Points`);
  console.log(`${Colors.Gold}2. ${Colors.RESET}Complete tasks`);
  console.log(`${Colors.Gold}3. ${Colors.Red}Exit${Colors.RESET}\n`);

  const choice = await prompt(`${Colors.RESET}Enter your choice (1 or 3): `);

  if (choice === "1") {
    console.clear();
    CoderMark();
    const runningMining = new Set(); // Track accounts being processed
    // Process mining points concurrently for each account.
    for (const accountData of loginData) {
      if (!runningMining.has(accountData.email)) {
        runningMining.add(accountData.email);
        runMiningPoints(accountData, agent, allAccounts);
      }
    }
  } else if (choice === "2") {
    console.clear();
    CoderMark();
    // Complete tasks sequentially for each account.
    for (const accountData of loginData) {
      await completeTasks(accountData, agent);
    }
  } else if (choice === "3") {
    console.clear();
    CoderMark();
    console.log(
      `${Colors.Red}Exiting the application. Goodbye!${Colors.RESET}`
    );
    process.exit(0);
  } else {
    console.log(Colors.Red + "Invalid choice. Exiting." + Colors.RESET);
    process.exit(1);
  }
}

// Clear console and start the application.
console.clear();
CoderMark();
main().catch((err) => {
  console.error(
    Colors.Red +
      "An unexpected error occurred: " +
      err.message +
      Colors.RESET
  );
  process.exit(1);
});

// Handle Ctrl+C (SIGINT) event.
process.on("SIGINT", () => {
  console.log(
    Colors.Yellow + "\nExiting... Clearing intervals..." + Colors.RESET
  );
  clearAllIntervals(globalLoginData);
  process.exit(0);
});

// Handle process "beforeExit" event.
process.on("beforeExit", (code) => {
  console.log(
    Colors.Yellow +
      `\nProcess exiting with code: ${code}. Clearing intervals...` +
      Colors.RESET
  );
  clearAllIntervals(globalLoginData);
});

// Handle uncaught exceptions.
process.on("uncaughtException", (err) => {
  console.error(Colors.Red + "Uncaught Exception:", err + Colors.RESET);
  console.log(
    Colors.Yellow +
      "Clearing intervals before exiting due to exception..." +
      Colors.RESET
  );
  clearAllIntervals(globalLoginData);
  process.exit(1);
});

// Handle unhandled promise rejections.
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    Colors.Red + "Unhandled Rejection at:", promise, "reason:", reason + Colors.RESET
  );
  console.log(
    Colors.Yellow +
      "Clearing intervals before exiting due to rejection..." +
      Colors.RESET
  );
  clearAllIntervals(globalLoginData);
  process.exit(1);
});
