import {approvalDate,isIdleStatus,statusValue,type Store,type Asset} from './assets.ts';

export type AgedAsset={asset:Asset;days:number;since:string};
export function agingStats(state:Store,now=new Date()):{idle:AgedAsset[];assigned:AgedAsset[]}{
 const today=Date.parse(approvalDate(now.toISOString())),last=new Map<string,{status:string;since:string}>();
 for(const event of state.events){const status=event.payload?.status;if(!status)continue;const previous=last.get(event.assetId);if(!previous||previous.status!==status)last.set(event.assetId,{status,since:event.time.slice(0,10)})}
 const age=(asset:Asset,since:string)=>{const date=Date.parse(since);if(!Number.isFinite(date))return null;return {asset,since,days:Math.max(0,Math.floor((today-date)/86400000))}};
 const idle:AgedAsset[]=[],assigned:AgedAsset[]=[];
 for(const asset of state.assets){if(isIdleStatus(state,asset.status)){const item=age(asset,last.get(asset.id)?.status===asset.status?last.get(asset.id)!.since:asset.purchased);if(item&&item.days>=90)idle.push(item)}else if(asset.status===statusValue(state,'active')&&asset.received){const item=age(asset,asset.received);if(item&&item.days>=180)assigned.push(item)}}
 return {idle:idle.sort((a,b)=>b.days-a.days),assigned:assigned.sort((a,b)=>b.days-a.days)};
}
