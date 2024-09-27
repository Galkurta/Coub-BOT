const fs = require("fs");
const axios = require("axios");
const path = require("path");
const printBanner = require("./config/banner.js");
const logger = require("./config/logger");

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

    console.log("Waiting to continue...");
    process.stdout.write(`Time remaining: ${formatTime(seconds)}`);

    for (let i = seconds - 1; i >= 0; i--) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      process.stdout.write(`Time remaining: ${formatTime(i)}`);
    }

    console.log("\nResuming operations...");
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
            logger.error(`Status Code: ${response.status} | Server Down`);
            return null;
          }
          retryCount++;
        } else {
          logger.warn(`Status Code: ${response.status}`);
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
      logger.error(`Unable to read rewards | Error: ${error.message}`);
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
        logger.info(`Task ${taskTitle} | Completed`);
        return response;
      } else {
        logger.warn(`Task ${taskTitle} | Failed`);
        return null;
      }
    } catch (error) {
      logger.error(
        `Task ${taskTitle} Unable to claim reward | ${error.message}`
      );
      return null;
    }
  }

  loadTask() {
    try {
      return JSON.parse(fs.readFileSync("task.json", "utf8"));
    } catch (error) {
      logger.error(`Unable to read tasks: ${error.message}`);
      return [];
    }
  }

  decodeUserInfo(encodedData) {
    const decodedData = decodeURIComponent(encodedData);
    const userDataMatch = decodedData.match(/user=({.*?})/);
    if (userDataMatch) {
      try {
        const userData = JSON.parse(userDataMatch[1]);
        return {
          firstName: userData.first_name || "",
          lastName: userData.last_name || "",
        };
      } catch (error) {
        logger.error(`Error parsing user data: ${error.message}`);
      }
    }
    return { firstName: "", lastName: "" };
  }

  async main() {
    try {
      printBanner();

      const tokenFile = path.join(__dirname, "token.txt");
      const dataFile = path.join(__dirname, "data.txt");

      if (!fs.existsSync(tokenFile) || !fs.existsSync(dataFile)) {
        throw new Error(`token.txt or data.txt file not found`);
      }

      const tokens = fs
        .readFileSync(tokenFile, "utf8")
        .split("\n")
        .filter(Boolean);
      const data = fs
        .readFileSync(dataFile, "utf8")
        .split("\n")
        .filter(Boolean);

      if (tokens.length === 0 || data.length === 0) {
        throw new Error("No valid data found in token.txt or data.txt");
      }
      const tasks = this.loadTask();
      while (true) {
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i].trim();
          const xTgAuth = data[i].trim();
          const { firstName, lastName } = this.decodeUserInfo(xTgAuth);

          logger.info(`Account ${i + 1} - ${firstName} ${lastName}`);

          const listId = [];
          const dataReward = await this.getRewards(token, xTgAuth);
          if (dataReward) {
            dataReward.forEach((data) => {
              const id = data.id || 0;
              listId.push(id);
            });
          } else {
            logger.warn(
              `Unable to get rewards for account ${
                i + 1
              } - ${firstName} ${lastName}`
            );
          }

          for (const task of tasks) {
            const id = task.id;
            if (listId.includes(id)) {
              logger.info(`${task.title} | Completed`);
            } else {
              logger.info(`Performing task | ${task.title}`);
              await this.claimTask(token, xTgAuth, task.id, task.title);
            }
          }
        }

        const delay = 24 * (3600 + Math.floor(Math.random() * 51));
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
