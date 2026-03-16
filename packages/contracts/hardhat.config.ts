import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: process.env["RPC_URL"] ?? "",
      accounts: process.env["DEPLOYER_PRIVATE_KEY"]
        ? [process.env["DEPLOYER_PRIVATE_KEY"]]
        : [],
    },
  },
  etherscan: {
    apiKey: process.env["ETHERSCAN_API_KEY"] ?? "",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
