 // The Graph event handlers for CundinaBlockSecure contracts
 // This file processes events emitted by individual block contracts
 
 import { BigInt, Bytes } from "@graphprotocol/graph-ts";
 import { MemberJoined, BlockCompleted } from "../generated/templates/CundinaBlockSecure/CundinaBlockSecure";
 import { Block, BlockMember, User, Transaction } from "../generated/schema";
 
 // ============= Member Joined =============
 
 export function handleMemberJoined(event: MemberJoined): void {
   let blockAddr = event.address;
   let blockId = blockAddr.toHexString();
   let memberAddr = event.params.member;
   let memberId = memberAddr.toHexString();
 
   // Load or create user
   let user = User.load(Bytes.fromHexString(memberId));
   if (!user) {
     user = new User(Bytes.fromHexString(memberId));
     user.level = 1;
     user.referralCode = Bytes.empty();
     user.registeredAt = event.block.timestamp;
     user.save();
   }
 
   // Create block membership
   let membershipId = blockId + "-" + memberId;
   let membership = new BlockMember(membershipId);
   membership.block = Bytes.fromHexString(blockId);
   membership.member = user.id;
   membership.position = event.params.position.toI32();
   membership.joinedAt = event.block.timestamp;
   membership.save();
 
   // Create join transaction
   let txId = event.transaction.hash;
   let tx = new Transaction(txId);
   tx.user = user.id;
   tx.type = "join";
   tx.amount = event.params.amount;
   tx.block = Bytes.fromHexString(blockId);
   tx.timestamp = event.block.timestamp;
   tx.save();
 }
 
 // ============= Block Completed =============
 
 export function handleBlockCompleted(event: BlockCompleted): void {
   let blockAddr = event.address;
   let blockId = blockAddr.toHexString();
 
   let block = Block.load(Bytes.fromHexString(blockId));
   if (block) {
     block.status = 1; // Completed
     block.completedAt = event.block.timestamp;
     block.save();
   }
 }