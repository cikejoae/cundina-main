const hre = require("hardhat");

async function main() {
  const CUNDINA_TOKEN_ADDRESS = "0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7";
  
  // Deploy BlockFactory
  console.log("Deploying BlockFactory...");
  const BlockFactory = await hre.ethers.getContractFactory("BlockFactory");
  
  // You need to set your platform wallet address here
  const PLATFORM_WALLET = "YOUR_PLATFORM_WALLET_ADDRESS"; // Change this!
  
  const factory = await BlockFactory.deploy(CUNDINA_TOKEN_ADDRESS, PLATFORM_WALLET);
  await factory.waitForDeployment();
  
  const factoryAddress = await factory.getAddress();
  console.log("BlockFactory deployed to:", factoryAddress);
  
  // Save deployment info
  console.log("\n=== DEPLOYMENT INFO ===");
  console.log("Network: Sepolia");
  console.log("CUNDINA Token:", CUNDINA_TOKEN_ADDRESS);
  console.log("BlockFactory:", factoryAddress);
  console.log("Platform Wallet:", PLATFORM_WALLET);
  console.log("\nUpdate these addresses in your .env file:");
  console.log(`VITE_BLOCK_FACTORY_ADDRESS=${factoryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
