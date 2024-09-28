const fs = require("fs").promises;
const axios = require("axios");
const path = require("path");
const qs = require("qs");
const { DateTime } = require("luxon");
const logger = require("./config/logger.js");
const printBanner = require("./config/banner.js");

class Coub {
  constructor() {
    this.headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language":
        "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://coub.com",
      Referer: "https://coub.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "sec-ch-ua":
        '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
    };
    this.tokenFile = path.join(__dirname, "token.json");
  }

  async countdown(seconds) {
    const formatTime = (timeInSeconds) => {
      const hours = Math.floor(timeInSeconds / 3600);
      const minutes = Math.floor((timeInSeconds % 3600) / 60);
      const seconds = timeInSeconds % 60;
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    };

    logger.info("Waiting to continue...");
    process.stdout.write(`Time remaining: ${formatTime(seconds)}`);

    for (let i = seconds - 1; i >= 0; i--) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      process.stdout.write(`Time remaining: ${formatTime(i)}`);
    }

    logger.info("\nResuming operations...");
  }

  async makeRequest(method, url, headers, data = null) {
    let retryCount = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const config = { headers, method };
        if (method.toUpperCase() === "GET" && data) {
          config.params = data;
        } else if (method.toUpperCase() === "POST") {
          config.data = data;
        }
        const response = await axios(url, config);
        if (response.status >= 200 && response.status < 300) {
          return response.data;
        } else if (response.status >= 500) {
          if (retryCount >= 3) {
            logger.error(`Status Code : ${response.status} | Server Down`);
            return null;
          }
          retryCount++;
        } else {
          logger.warn(`Status Code : ${response.status}`);
          break;
        }
      } catch (error) {
        console.log(error);
        logger.error(`Error: ${error.message}`);
        if (retryCount >= 3) return null;
        retryCount++;
      }
    }
  }

  async getRewards(token, xTgAuth) {
    const headers = {
      ...this.headers,
      authorization: `Bearer ${token}`,
      "x-tg-authorization": xTgAuth,
    };
    const url = "https://rewards.coub.com/api/v2/get_user_rewards";
    try {
      return await this.makeRequest("GET", url, headers);
    } catch (error) {
      logger.error(`Unable to read rewards. Error: ${error.message}`);
      return null;
    }
  }

  async claimTask(token, xTgAuth, taskId, taskTitle) {
    const headers = {
      ...this.headers,
      authorization: `Bearer ${token}`,
      "x-tg-authorization": xTgAuth,
    };
    const url = "https://rewards.coub.com/api/v2/complete_task";
    const params = { task_reward_id: taskId };
    try {
      const response = await this.makeRequest("GET", url, headers, params);
      if (response) {
        logger.info(`Task ${taskTitle} Completed`);
        return response;
      } else {
        logger.warn(`Task ${taskTitle} Failed`);
        return null;
      }
    } catch (error) {
      logger.error(
        `Task ${taskTitle} Unable to claim reward | error: ${error.message}`
      );
      return null;
    }
  }

  async loadTask() {
    try {
      const data = await fs.readFile("task.json", "utf8");
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Unable to read tasks: ${error.message}`);
      return [];
    }
  }

  parseAccountData(rawData) {
    const parsedData = qs.parse(rawData);
    const user = JSON.parse(decodeURIComponent(parsedData.user));
    return {
      user: JSON.stringify(user),
      chat_instance: parsedData.chat_instance,
      chat_type: parsedData.chat_type,
      start_param: parsedData.start_param,
      auth_date: parsedData.auth_date,
      hash: parsedData.hash,
    };
  }

  async getAndSaveToken(rawAccountData, accountIndex) {
    const loginUrl = "https://coub.com/api/v2/sessions/login_mini_app";
    const signupUrl = "https://coub.com/api/v2/sessions/signup_mini_app";
    const parsedAccountData = this.parseAccountData(rawAccountData);
    const data = qs.stringify(parsedAccountData);

    const config = {
      headers: {
        ...this.headers,
      },
    };

    let apiToken;
    try {
      const loginResponse = await axios.post(loginUrl, data, config);
      apiToken = loginResponse.data.api_token;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        logger.warn("Registering account...");
        try {
          const signupResponse = await axios.post(signupUrl, data, config);
          apiToken = signupResponse.data.api_token;
        } catch (signupError) {
          logger.error(`Error during registration: ${signupError.message}`);
          throw signupError;
        }
      } else {
        logger.error(`Error during login: ${error.message}`);
        throw error;
      }
    }

    if (!apiToken) {
      throw new Error("Unable to obtain api_token");
    }

    try {
      const torusUrl = "https://coub.com/api/v2/torus/token";
      const torusConfig = {
        headers: {
          ...this.headers,
          "x-auth-token": apiToken,
        },
      };

      const torusResponse = await axios.post(torusUrl, null, torusConfig);
      const token = torusResponse.data.access_token;
      await this.updateTokenFile(token, accountIndex);

      return token;
    } catch (error) {
      logger.error(`Error getting token from torus: ${error.message}`);
      throw error;
    }
  }

  async readTokens() {
    try {
      const data = await fs.readFile(this.tokenFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.info("token.json file not found, creating new");
        return {};
      }
      logger.error(`Error reading token.json file: ${error.message}`);
      return {};
    }
  }

  async updateTokenFile(token, accountIndex) {
    try {
      let tokens = await this.readTokens();
      const accountKey = `${accountIndex + 1}`;

      if (tokens[accountKey] !== token) {
        tokens[accountKey] = token;
        await fs.writeFile(this.tokenFile, JSON.stringify(tokens, null, 2));
        logger.info(`Successfully obtained token | ${accountIndex + 1}`);
      } else {
        logger.info(`Token for account ${accountIndex + 1} has been updated`);
      }
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      throw error;
    }
  }

  async readAccountData() {
    try {
      const dataFile = path.join(__dirname, "data.txt");
      const data = await fs.readFile(dataFile, "utf8");
      return data
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/\r$/, ""));
    } catch (error) {
      throw new Error(`Unable to read data.txt file: ${error.message}`);
    }
  }

  isExpired(token) {
    const [header, payload, sign] = token.split(".");
    const decodedPayload = Buffer.from(payload, "base64").toString();

    try {
      const parsedPayload = JSON.parse(decodedPayload);
      const now = Math.floor(DateTime.now().toSeconds());

      if (parsedPayload.exp) {
        const expirationDate = DateTime.fromSeconds(
          parsedPayload.exp
        ).toLocal();
        logger.info(
          `Token expires | ${expirationDate.toFormat("yyyy-MM-dd HH:mm:ss")}`
        );

        const isExpired = now > parsedPayload.exp;
        logger.info(
          `Has the token expired? ${
            isExpired
              ? "Yes, you need to replace the token"
              : "No run at full speed"
          }`
        );

        return isExpired;
      } else {
        logger.warn(`Perpetual token, unable to read expiration time`);
        return false;
      }
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      return true;
    }
  }

  async main() {
    try {
      printBanner();
      const accountsData = await this.readAccountData();

      if (accountsData.length === 0) {
        throw new Error("No valid data found in data.txt");
      }

      const tasks = await this.loadTask();
      let tokens = await this.readTokens();

      while (true) {
        for (let i = 0; i < accountsData.length; i++) {
          const accountKey = `${i + 1}`;
          let token = tokens[accountKey];
          const parsedAccountData = this.parseAccountData(accountsData[i]);
          const user = JSON.parse(parsedAccountData.user);
          logger.info(
            `Account ${i + 1} - ${user.first_name} ${user.last_name}`
          );

          if (!token || this.isExpired(token)) {
            logger.info(
              `Token for | ${user.first_name} ${user.last_name} does not exist or has expired. Getting new token`
            );
            try {
              const rawAccountData = accountsData[i];
              token = await this.getAndSaveToken(rawAccountData, i);
              if (token) {
                tokens = await this.readTokens();
              } else {
                logger.error(
                  `Failed to get token | ${user.first_name} ${user.last_name} | Moving to next account`
                );
                continue;
              }
            } catch (error) {
              logger.error(
                `Failed to get token  | ${user.first_name} ${user.last_name} | ${error.message}`
              );
              continue;
            }
          }

          const xTgAuth = qs.stringify(parsedAccountData);

          const listId = [];
          const dataReward = await this.getRewards(token, xTgAuth);
          if (dataReward) {
            dataReward.forEach((data) => {
              const id = data.id || 0;
              listId.push(id);
            });
          } else {
            logger.warn(
              `Unable to get rewards | ${user.first_name} ${user.last_name}`
            );
          }

          for (const task of tasks) {
            const id = task.id;
            if (listId.includes(id)) {
              logger.info(
                `${task.title} | Completed | ${user.first_name} ${user.last_name}`
              );
            } else {
              logger.info(
                `Performing task ${task.title} | ${user.first_name} ${user.last_name}`
              );
              await this.claimTask(token, xTgAuth, task.id, task.title);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        const delay = 24 * 3600 + Math.floor(Math.random() * 3600);
        await this.countdown(delay);
      }
    } catch (error) {
      console.log(error);
      logger.error(`Error: ${error.message}`);
      if (error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
    }
  }
}

const coub = new Coub();
coub.main().catch((error) => logger.error(`Unhandled error: ${error.message}`));
