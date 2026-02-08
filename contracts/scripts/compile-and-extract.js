const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔨 Compiling contracts...");
  
  // Compile contracts
  await hre.run("compile");
  
  console.log("✅ Compilation complete!");
  
  // Read BlockFactory artifact
  const factoryArtifactPath = path.join(
    __dirname,
    "../artifacts/contracts/BlockFactory.sol/BlockFactory.json"
  );
  
  const factoryArtifact = JSON.parse(fs.readFileSync(factoryArtifactPath, "utf8"));
  const factoryBytecode = factoryArtifact.bytecode;
  const factoryAbi = factoryArtifact.abi;
  
  console.log("\n📦 BlockFactory Bytecode:");
  console.log(`Length: ${factoryBytecode.length} characters`);
  console.log(`First 100 chars: ${factoryBytecode.substring(0, 100)}...`);
  
  // Read CundinaBlock artifact  
  const blockArtifactPath = path.join(
    __dirname,
    "../artifacts/contracts/CundinaBlock.sol/CundinaBlock.json"
  );
  
  const blockArtifact = JSON.parse(fs.readFileSync(blockArtifactPath, "utf8"));
  const blockBytecode = blockArtifact.bytecode;
  
  console.log("\n📦 CundinaBlock Bytecode:");
  console.log(`Length: ${blockBytecode.length} characters`);
  
  // Generate edge function code with embedded bytecode
  const edgeFunctionContent = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ethers } from "https://esm.sh/ethers@6.13.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CUNDINA_TOKEN_ADDRESS = "0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7";

// BlockFactory compiled bytecode
const FACTORY_BYTECODE = "${factoryBytecode}";

const FACTORY_ABI = ${JSON.stringify(factoryAbi, null, 2)};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RPC_URL = Deno.env.get('SEPOLIA_RPC_URL');
    const PRIVATE_KEY = Deno.env.get('DEPLOYER_PRIVATE_KEY');
    const PLATFORM_WALLET = Deno.env.get('PLATFORM_WALLET_ADDRESS');

    if (!RPC_URL || !PRIVATE_KEY || !PLATFORM_WALLET) {
      throw new Error('Missing required environment variables');
    }

    console.log('🚀 Starting deployment...');
    
    // Connect to Sepolia
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log('Deploying from wallet:', wallet.address);
    console.log('Platform wallet:', PLATFORM_WALLET);
    console.log('Cundina Token:', CUNDINA_TOKEN_ADDRESS);

    // Deploy BlockFactory
    console.log('📝 Deploying BlockFactory contract...');
    const factory = new ethers.ContractFactory(FACTORY_ABI, FACTORY_BYTECODE, wallet);
    const contract = await factory.deploy(CUNDINA_TOKEN_ADDRESS, PLATFORM_WALLET);
    
    console.log('⏳ Waiting for deployment transaction...');
    await contract.waitForDeployment();
    
    const factoryAddress = await contract.getAddress();
    console.log('✅ BlockFactory deployed to:', factoryAddress);

    // Verify deployment
    const code = await provider.getCode(factoryAddress);
    if (code === '0x') {
      throw new Error('Contract deployment failed - no code at address');
    }

    console.log('✨ Deployment successful!');

    return new Response(
      JSON.stringify({
        success: true,
        factoryAddress,
        network: 'sepolia',
        deployer: wallet.address,
        platformWallet: PLATFORM_WALLET,
        cundinaToken: CUNDINA_TOKEN_ADDRESS,
        message: 'BlockFactory deployed successfully! Update your .env with: VITE_BLOCK_FACTORY_ADDRESS=' + factoryAddress
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('❌ Deployment error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});`;

  // Write the edge function
  const edgeFunctionPath = path.join(
    __dirname,
    "../../supabase/functions/deploy-contracts/index.ts"
  );
  
  fs.writeFileSync(edgeFunctionPath, edgeFunctionContent);
  
  console.log("\n✅ Edge function updated with compiled bytecode!");
  console.log(`📍 Location: ${edgeFunctionPath}`);
  console.log("\n🎯 Next steps:");
  console.log("1. The deploy-contracts edge function has been updated");
  console.log("2. Call the function to deploy to Sepolia");
  console.log("3. Update VITE_BLOCK_FACTORY_ADDRESS in .env with the deployed address");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
