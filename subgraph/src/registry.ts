// The Graph event handlers for BlockRegistryFactory
// This file processes events emitted by the Registry contract

import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  UserRegistered,
  MyBlockCreated,
  ReferralCodeGenerated,
  ReferralChainCreated,
  InviteCountUpdated,
  BlockSettled,
} from "../generated/BlockRegistryFactory/BlockRegistryFactory";
import { User, Block, Transaction, RankingSnapshot, DailyRankingPosition } from "../generated/schema";
import { CundinaBlockSecure } from "../generated/templates";

// Helper function to get unix day from timestamp
function getUnixDay(timestamp: BigInt): BigInt {
  return timestamp.div(BigInt.fromI32(86400));
}

// Helper function to create a ranking snapshot for a block
function createRankingSnapshot(block: Block, timestamp: BigInt): void {
  let day = getUnixDay(timestamp);
  let snapshotId = block.id.toHexString() + "-" + day.toString();
  
  let snapshot = new RankingSnapshot(snapshotId);
  snapshot.block = block.id;
  snapshot.levelId = block.levelId;
  snapshot.invitedCount = block.invitedCount;
  snapshot.memberCount = block.members.length;
  snapshot.day = day;
  snapshot.timestamp = timestamp;
  snapshot.save();
}

// Helper function to update daily ranking position
function updateDailyRankingPosition(block: Block, position: i32, timestamp: BigInt): void {
  let day = getUnixDay(timestamp);
  let positionId = block.levelId.toString() + "-" + day.toString() + "-" + block.id.toHexString();
  
  let dailyPosition = new DailyRankingPosition(positionId);
  dailyPosition.block = block.id;
  dailyPosition.levelId = block.levelId;
  dailyPosition.day = day;
  dailyPosition.position = position;
  dailyPosition.invitedCount = block.invitedCount;
  dailyPosition.timestamp = timestamp;
  dailyPosition.save();
}
 
 // ============= User Registration =============
 
 export function handleUserRegistered(event: UserRegistered): void {
   let userId = event.params.user.toHexString();
   let user = User.load(Bytes.fromHexString(userId));
 
   if (!user) {
     user = new User(Bytes.fromHexString(userId));
     user.referralCode = Bytes.empty();
     user.registeredAt = event.block.timestamp;
   }
 
   user.level = event.params.level.toI32();
 
   // Set referrer if provided
   let referrerAddr = event.params.referrer;
   if (referrerAddr.notEqual(Address.zero())) {
     let referrerId = referrerAddr.toHexString();
     let referrer = User.load(Bytes.fromHexString(referrerId));
     if (referrer) {
       user.referrer = referrer.id;
     }
   }
 
   user.save();
 
   // Create registration transaction
   let txId = event.transaction.hash;
   let tx = new Transaction(txId);
   tx.user = user.id;
   tx.type = "registration";
   tx.amount = BigInt.zero(); // Registration fee amount would come from contract call
   tx.timestamp = event.block.timestamp;
   tx.save();
 }
 
 // ============= Block Creation =============
 
 export function handleMyBlockCreated(event: MyBlockCreated): void {
   let blockAddr = event.params.blockAddress;
   let blockId = blockAddr.toHexString();
 
   let block = new Block(Bytes.fromHexString(blockId));
   
   // Set owner
   let ownerId = event.params.center.toHexString();
   let owner = User.load(Bytes.fromHexString(ownerId));
   if (!owner) {
     owner = new User(Bytes.fromHexString(ownerId));
     owner.level = event.params.level.toI32();
     owner.referralCode = Bytes.empty();
     owner.registeredAt = event.block.timestamp;
     owner.save();
   }
 
  block.owner = owner.id;
  block.levelId = event.params.level.toI32();
  block.status = 0; // Active
  block.invitedCount = 0;
  block.createdAt = event.block.timestamp;
  block.save();

  // Create initial ranking snapshot for new block
  createRankingSnapshot(block, event.block.timestamp);

  // Start tracking events from this block contract
  CundinaBlockSecure.create(blockAddr);
}
 
 // ============= Referral Code Generation =============
 
 export function handleReferralCodeGenerated(event: ReferralCodeGenerated): void {
   let userId = event.params.wallet.toHexString();
   let user = User.load(Bytes.fromHexString(userId));
 
   if (user) {
     user.referralCode = event.params.code;
     user.save();
   }
 }
 
 // ============= Referral Chain =============
 
 export function handleReferralChainCreated(event: ReferralChainCreated): void {
   let userId = event.params.user.toHexString();
   let referrerId = event.params.referrer.toHexString();
 
   let user = User.load(Bytes.fromHexString(userId));
   let referrer = User.load(Bytes.fromHexString(referrerId));
 
   if (user && referrer) {
     user.referrer = referrer.id;
     user.save();
   }
 }
 
 // ============= Invite Count Update =============
 
export function handleInviteCountUpdated(event: InviteCountUpdated): void {
  let blockId = event.params.blockAddr.toHexString();
  let block = Block.load(Bytes.fromHexString(blockId));

  if (block) {
    block.invitedCount = event.params.newCount.toI32();
    block.save();
    
    // Create ranking snapshot for trend tracking
    createRankingSnapshot(block, event.block.timestamp);
  }
}

// ============= Block Settled (Advance / Cashout) =============

export function handleBlockSettled(event: BlockSettled): void {
  let centerAddr = event.params.center.toHexString();
  let user = User.load(Bytes.fromHexString(centerAddr));

  if (!user) return;

  let currentLevel = event.params.level.toI32();
  let advanced = event.params.advanced;

  if (advanced) {
    // User advanced to next level
    user.level = currentLevel + 1;
  } else {
    // Cashout/reset — user goes back to level 1
    user.level = 1;
  }
  user.save();

  // Record the advance/cashout transaction
  let txId = event.transaction.hash;
  let tx = new Transaction(txId);
  tx.user = user.id;
  tx.type = advanced ? "advance" : "cashout";
  tx.amount = BigInt.zero();
  tx.block = event.params.blockAddress;
  tx.timestamp = event.block.timestamp;
  tx.save();
}