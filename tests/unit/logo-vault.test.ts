import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LogoVault } from "../../src/server/logo-vault";
import * as sanitizer from "../../src/server/logo-sanitizer";
import { logoFixture } from "../helpers/logo-fixtures";
const vaults:LogoVault[]=[];
afterEach(()=>{for(const v of vaults.splice(0))v.close();vi.restoreAllMocks();});
function setup(){const vault=new LogoVault();vaults.push(vault);return{vault,owner:{expiresAt:Date.now()+7200000},org:randomUUID(),other:randomUUID()};}
it("stages separately and explicitly selects, replaces, lays out and removes exact scoped revisions",async()=>{
  const{vault,owner,org,other}=setup(),bytes=await logoFixture(),operationId=randomUUID(),state=await vault.stage(owner,org,bytes,0,operationId,async()=>{});
  expect(state.selected).toBeNull();expect(state.staged).not.toBeNull();expect(await vault.stage(owner,org,bytes,0,operationId,async()=>{})).toEqual(state);
  expect(()=>vault.image(owner,other,state.staged!.id,true)).toThrow(/unavailable/);expect(()=>vault.image(owner,org,state.staged!.id,false)).toThrow(/unavailable/);
  const selected=vault.command(owner,org,{action:"select",assetId:state.staged!.id,revision:1,operationId:randomUUID()});
  const next=await vault.stage(owner,org,bytes,selected.revision,randomUUID(),async()=>{});
  expect(next.selected).toEqual(selected.selected);expect(next.staged!.id).not.toBe(selected.selected!.id);
  expect(()=>vault.command(owner,org,{action:"remove",assetId:next.selected!.id,revision:1,operationId:randomUUID()})).toThrow(/changed/);
  const shaped=vault.command(owner,org,{action:"layout",assetId:next.staged!.id,revision:next.revision,operationId:randomUUID(),display:"rectangle"});
  const replaced=vault.command(owner,org,{action:"select",assetId:shaped.staged!.id,revision:shaped.revision,operationId:randomUUID()});
  expect(replaced.selected!.display).toBe("rectangle");expect(()=>vault.image(owner,org,selected.selected!.id,true)).toThrow(/unavailable/);
  const removed=vault.command(owner,org,{action:"remove",assetId:replaced.selected!.id,revision:replaced.revision,operationId:randomUUID()});
  expect(removed.selected).toBeNull();expect(removed.staged).toBeNull();expect(vault.state(owner,other).revision).toBe(0);
});
it("refuses competing writes, conflicting replay and lost authority without replacing assets",async()=>{
  const{vault,owner,org}=setup(),bytes=await logoFixture(),first=await vault.stage(owner,org,bytes,0,randomUUID(),async()=>{});
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),id=randomUUID();
  const pending=vault.stage(owner,org,bytes,first.revision,id,async()=>gate);
  await expect(vault.stage(owner,org,bytes,first.revision,randomUUID(),async()=>{})).rejects.toMatchObject({status:423});
  expect(()=>vault.command(owner,org,{action:"remove",assetId:first.staged!.id,revision:1,operationId:randomUUID()})).toThrow(/busy/);
  release();const after=await pending;
  await expect(vault.stage(owner,org,Buffer.from("changed"),first.revision,id,async()=>{})).rejects.toThrow(/different choices/);
  await expect(vault.stage(owner,org,bytes,after.revision,randomUUID(),async()=>{throw new Error("authorization revoked");})).rejects.toThrow(/revoked/);
  expect(vault.state(owner,org).staged!.id).toBe(after.staged!.id);
});
it("retains attempt quotas across failures and refuses failed retries",async()=>{
  const{vault,owner,org}=setup();
  for(let i=0;i<12;i++){const id=randomUUID();await expect(vault.stage(owner,org,Buffer.from("hostile"),0,id,async()=>{})).rejects.toThrow();await expect(vault.stage(owner,org,Buffer.from("hostile"),0,id,async()=>{})).rejects.toThrow(/earlier/);}
  expect(vault.state(owner,org).remainingUploads).toBe(0);await expect(vault.stage(owner,org,await logoFixture(),0,randomUUID(),async()=>{})).rejects.toMatchObject({status:429});
});
it("expires staged bytes without reverting private revisions or another owner's state",async()=>{
  const{vault,owner,org}=setup(),bytes=await logoFixture(),first=await vault.stage(owner,org,bytes,0,randomUUID(),async()=>{}),other={expiresAt:owner.expiresAt+7200000};
  const old=await vault.stage(other,org,bytes,0,randomUUID(),async()=>{});
  const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+600001);vault.sweep();
  expect(vault.state(owner,org).staged).toBeNull();expect(vault.state(owner,org).revision).toBe(2);expect(()=>vault.image(owner,org,first.staged!.id,true)).toThrow();
  vi.mocked(Date.now).mockReturnValue(now);expect(vault.state(owner,org).revision).toBe(2);
  const fresh=await vault.stage(other,org,bytes,vault.state(other,org).revision,randomUUID(),async()=>{});
  vault.command(other,org,{action:"select",assetId:fresh.staged!.id,revision:fresh.revision,operationId:randomUUID()});
  vi.mocked(Date.now).mockReturnValue(owner.expiresAt+1);vault.sweep();expect(()=>vault.state(owner,org)).toThrow(/ended/);expect(vault.state(other,org).selected!.id).not.toBe(old.staged!.id);
});
it("bounds decoders globally and refuses expiration during processing",async()=>{
  const{vault,owner,org,other}=setup(),bytes=await logoFixture();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const first=vault.stage(owner,org,bytes,0,randomUUID(),async()=>gate),second=vault.stage(owner,other,bytes,0,randomUUID(),async()=>gate);
  await expect(vault.stage(owner,randomUUID(),bytes,0,randomUUID(),async()=>{})).rejects.toMatchObject({status:429});
  release();await Promise.all([first,second]);
  await expect(vault.stage(owner,org,bytes,1,randomUUID(),async()=>{owner.expiresAt=Date.now()-1;})).rejects.toMatchObject({status:401});expect(()=>vault.state(owner,org)).toThrow(/ended/);
});
it("preserves two exact cleanup receipts at the ordinary operation quota",async()=>{
  const{vault,owner,org}=setup(),bytes=await logoFixture();
  let state=await vault.stage(owner,org,bytes,0,randomUUID(),async()=>{});state=vault.command(owner,org,{action:"select",assetId:state.staged!.id,revision:state.revision,operationId:randomUUID()});
  state=await vault.stage(owner,org,bytes,state.revision,randomUUID(),async()=>{});
  for(let i=0;i<61;i++)state=vault.command(owner,org,{action:"layout",assetId:state.staged!.id,revision:state.revision,operationId:randomUUID(),display:i%2?"square":"rectangle"});
  await expect(vault.stage(owner,org,bytes,state.revision,randomUUID(),async()=>{})).rejects.toMatchObject({status:429});
  expect(()=>vault.command(owner,org,{action:"remove",assetId:randomUUID(),revision:state.revision,operationId:randomUUID()})).toThrow(/unavailable/);
  state=vault.command(owner,org,{action:"remove",assetId:state.selected!.id,revision:state.revision,operationId:randomUUID()});
  state=vault.command(owner,org,{action:"remove",assetId:state.staged!.id,revision:state.revision,operationId:randomUUID()});expect(state.selected).toBeNull();expect(state.staged).toBeNull();
});
it("enforces session and global storage reservations across owners without evicting their images",async()=>{
  // Isolate vault accounting at the exact maximum output size; real native decoding is tested separately.
  vi.spyOn(sanitizer,"sanitizeLogo").mockImplementation(async()=>({bytes:Buffer.alloc(262144,1),width:512,height:128}));
  const{vault}=setup(),owners=Array.from({length:17},()=>({expiresAt:Date.now()+7200000})),bytes=Uint8Array.of(1);
  for(let i=0;i<16;i++)for(let j=0;j<4;j++){
    const org="quota-"+j;let state=await vault.stage(owners[i],org,bytes,0,randomUUID(),async()=>{});
    state=vault.command(owners[i],org,{action:"select",assetId:state.staged!.id,revision:state.revision,operationId:randomUUID()});
    await vault.stage(owners[i],org,bytes,state.revision,randomUUID(),async()=>{});
  }
  await expect(vault.stage(owners[0],"extra",bytes,0,randomUUID(),async()=>{})).rejects.toMatchObject({status:429});
  await expect(vault.stage(owners[16],"extra",bytes,0,randomUUID(),async()=>{})).rejects.toMatchObject({status:429});
  const retained=vault.state(owners[1],"quota-0");vault.drop(owners[0]);
  expect(vault.state(owners[1],"quota-0")).toEqual(retained);
  expect((await vault.stage(owners[16],"extra",bytes,0,randomUUID(),async()=>{})).staged).not.toBeNull();
});
