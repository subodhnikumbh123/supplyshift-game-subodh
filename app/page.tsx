'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Inventory = Record<string, Record<string, number>>;
type Prices = Record<string, number>;
type Order = { id:number; product:string; region:string; qty:number; playerQty:number; agentQty:number; playerPrice:number; agentPrice:number; playerFilled:boolean; agentFilled:boolean };
type ModelOutput = { point:number; safety:number; confidence:number };
type Phase = 'planning'|'live'|'review';
type MarketProfile = {seed:number;growth:Prices;elasticity:Prices;seasonStrength:Prices;waveAmp:Prices;wavePhase:Prices;affinity:Inventory;eventMonth:Prices;eventRegion:Record<string,string>;eventLift:Prices};

const MONTH_SECONDS=45;
const PRODUCTS=[
  {id:'pulse',name:'Pulse Pods',emoji:'🎧',color:'#ff5f7e',price:72,cost:38,supply:60},
  {id:'orbit',name:'Orbit Watch',emoji:'⌚',color:'#ffca3a',price:96,cost:52,supply:55},
  {id:'boom',name:'Boom Box',emoji:'🔊',color:'#39c9bf',price:58,cost:27,supply:65},
];
const REGIONS=[
  {id:'west',name:'West',city:'Los Angeles',color:'#ff5f7e'},
  {id:'central',name:'Central',city:'Chicago',color:'#ffca3a'},
  {id:'east',name:'East',city:'New York',color:'#4f8cff'},
];
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const emptyInventory=(value=0):Inventory=>Object.fromEntries(PRODUCTS.map(p=>[p.id,Object.fromEntries(REGIONS.map(r=>[r.id,value]))]));
const cloneInventory=(inv:Inventory):Inventory=>Object.fromEntries(Object.entries(inv).map(([p,regions])=>[p,{...regions}]));
const initialPlan=():Inventory=>emptyInventory(0);
const basePrices=():Prices=>Object.fromEntries(PRODUCTS.map(p=>[p.id,p.price]));
const seasonFor=(month:number)=>month<=3?{name:'WINTER',emoji:'❄️',mult:1}:month<=6?{name:'SPRING',emoji:'🌷',mult:1.06}:month<=9?{name:'SUMMER',emoji:'☀️',mult:1.14}:{name:'HOLIDAY',emoji:'🎁',mult:1.34};
const seasonalLift=(month:number,product:string,region:string)=>{
  let lift=seasonFor(month).mult;
  if(month>=10&&product==='orbit')lift*=1.28;
  if(month>=6&&month<=9&&product==='boom')lift*=1.2;
  if((month===8||month===9)&&product==='pulse')lift*=1.15;
  if(region==='east')lift*=1.1;if(region==='west'&&month>=6&&month<=9)lift*=1.08;
  return lift;
};
const seededRandom=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296};
const createMarketProfile=(seed:number):MarketProfile=>{const random=seededRandom(seed),priceMap=(min:number,max:number):Prices=>Object.fromEntries(PRODUCTS.map(p=>[p.id,min+random()*(max-min)]));return {seed,growth:priceMap(-.025,.045),elasticity:priceMap(1.15,2.35),seasonStrength:priceMap(.65,1.55),waveAmp:priceMap(.02,.2),wavePhase:priceMap(0,Math.PI*2),affinity:Object.fromEntries(PRODUCTS.map(p=>[p.id,Object.fromEntries(REGIONS.map(r=>[r.id,.72+random()*.66]))])),eventMonth:Object.fromEntries(PRODUCTS.map(p=>[p.id,2+Math.floor(random()*10)])),eventRegion:Object.fromEntries(PRODUCTS.map(p=>[p.id,REGIONS[Math.floor(random()*REGIONS.length)].id])),eventLift:priceMap(1.25,1.85)};};
const DEFAULT_MARKET=createMarketProfile(481527);
const marketSignal=(market:MarketProfile,month:number,product:string,region:string)=>{const fixedSeason=seasonalLift(month,product,region),season=1+(fixedSeason-1)*market.seasonStrength[product],growth=Math.pow(1+market.growth[product],month-1),wave=1+market.waveAmp[product]*Math.sin(month*Math.PI/6+market.wavePhase[product]),event=market.eventMonth[product]===month&&market.eventRegion[product]===region?market.eventLift[product]:1;return Math.max(.35,market.affinity[product][region]*season*growth*wave*event)};
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:18;
const modelForecast=(history:Inventory[],product:string,region:string,targetMonth:number):ModelOutput=>{
  const series=history.map(h=>h[product][region]);
  if(!series.length)return {point:Math.round(18*seasonalLift(targetMonth,product,region)),safety:5,confidence:74};
  const alpha=.64;let level=series[0];series.slice(1).forEach(x=>{level=alpha*x+(1-alpha)*level});
  const recent=series.at(-1)!;const prior=series.at(-2)??recent;const older=series.at(-3)??prior;
  const trend=.68*(recent-prior)+.32*(prior-older);
  const avg=mean(series.slice(-6));
  const variance=mean(series.slice(-6).map(x=>(x-avg)**2));const sigma=Math.sqrt(variance);
  const momentum=avg?Math.max(.78,Math.min(1.28,recent/avg)):1;
  const blended=.5*(level+trend)+.3*recent*momentum+.2*avg;
  const point=Math.max(6,Math.round(blended*seasonalLift(targetMonth,product,region)));
  const safety=Math.max(3,Math.round(1.65*sigma+2));
  const confidence=Math.max(76,Math.min(98,Math.round(96-sigma*.8+series.length*.7)));
  return {point,safety,confidence};
};
const agentPlanFor=(history:Inventory[],inventory:Inventory,targetMonth:number):Inventory=>{
  const plan=emptyInventory(0);
  PRODUCTS.forEach(p=>{
    const needs=REGIONS.map(r=>{const m=modelForecast(history,p.id,r.id,targetMonth);return Math.max(0,m.point+m.safety-inventory[p.id][r.id])});
    const total=needs.reduce((a,b)=>a+b,0);let used=0;
    REGIONS.forEach((r,i)=>{const raw=total<=p.supply?needs[i]:p.supply*needs[i]/Math.max(1,total);const q=i===2?Math.min(Math.max(0,p.supply-used),Math.round(raw)):Math.max(0,Math.round(raw));plan[p.id][r.id]=q;used+=q});
  });
  return plan;
};
const agentPricesFor=(history:Inventory[],inventory:Inventory,targetMonth:number):Prices=>Object.fromEntries(PRODUCTS.map(product=>{
  const forecast=REGIONS.reduce((sum,region)=>sum+modelForecast(history,product.id,region.id,targetMonth).point,0);
  const available=REGIONS.reduce((sum,region)=>sum+inventory[product.id][region.id],0)+product.supply;
  const candidates=[.82,.88,.94,1,1.06,1.12,1.18,1.24,1.3].map(mult=>Math.round(product.price*mult));
  let bestPrice=product.price,bestScore=-Infinity;
  candidates.forEach(price=>{
    const expectedDemand=forecast*Math.pow(product.price/price,1.7);
    const sold=Math.min(available,expectedDemand);
    const missed=Math.max(0,expectedDemand-available),left=Math.max(0,available-sold);
    const score=sold*price-left*.45-missed*.01;
    if(score>bestScore){bestScore=score;bestPrice=price}
  });
  return [product.id,bestPrice];
}));

export default function Home(){
  const [screen,setScreen]=useState<'intro'|'game'|'results'>('intro');
  const [phase,setPhase]=useState<Phase>('planning'),[speed,setSpeed]=useState(1);
  const [market,setMarket]=useState<MarketProfile>(DEFAULT_MARKET);
  const [month,setMonth]=useState(1),[seconds,setSeconds]=useState(MONTH_SECONDS),[selected,setSelected]=useState('pulse');
  const [orders,setOrders]=useState<Order[]>([]),[orderCount,setOrderCount]=useState(0);
  const [demandHistory,setDemandHistory]=useState<Inventory[]>([]),[showLedger,setShowLedger]=useState(false);
  const [playerInv,setPlayerInv]=useState<Inventory>(emptyInventory(0)),[agentInv,setAgentInv]=useState<Inventory>(emptyInventory(0));
  const [playerPlan,setPlayerPlan]=useState<Inventory>(initialPlan()),[agentPlan,setAgentPlan]=useState<Inventory>(()=>agentPlanFor([],emptyInventory(0),1));
  const [lastAgentPlan,setLastAgentPlan]=useState<Inventory>(emptyInventory(0));
  const [playerPrices,setPlayerPrices]=useState<Prices>(basePrices()),[agentPrices,setAgentPrices]=useState<Prices>(basePrices());
  const [playerPricePlan,setPlayerPricePlan]=useState<Prices>(basePrices()),[agentPricePlan,setAgentPricePlan]=useState<Prices>(()=>agentPricesFor([],emptyInventory(0),1));
  const [lastAgentPrices,setLastAgentPrices]=useState<Prices>(basePrices());
  const [playerRevenue,setPlayerRevenue]=useState(0),[agentRevenue,setAgentRevenue]=useState(0);
  const [playerInventoryCost,setPlayerInventoryCost]=useState(0),[agentInventoryCost,setAgentInventoryCost]=useState(0);
  const [playerStorageCost,setPlayerStorageCost]=useState(0),[agentStorageCost,setAgentStorageCost]=useState(0);
  const [playerFilled,setPlayerFilled]=useState(0),[agentFilled,setAgentFilled]=useState(0),[playerMissed,setPlayerMissed]=useState(0),[agentMissed,setAgentMissed]=useState(0);
  const [monthDemand,setMonthDemand]=useState<Inventory>(emptyInventory(0)),[flashRegion,setFlashRegion]=useState('');
  const playerRef=useRef(playerInv),agentRef=useRef(agentInv),demandRef=useRef(monthDemand),historyRef=useRef<Inventory[]>([]),orderId=useRef(1),closingRef=useRef(false);

  const publicForecast=useCallback((product:string,region:string)=>{
    const history=historyRef.current;const past=history.map(h=>h[product][region]);
    const elapsed=Math.max(6,MONTH_SECONDS-seconds);const projected=phase==='live'?demandRef.current[product][region]*MONTH_SECONDS/elapsed:0;
    const baseline=past.length?.65*mean(past.slice(-3))+.35*projected:projected||18;
    return Math.max(7,Math.round(baseline*seasonalLift(month,product,region)));
  },[month,seconds,phase]);

  const generateOrder=useCallback(()=>{
    if(screen!=='game'||phase!=='live')return;
    const pairs=PRODUCTS.flatMap((product,pi)=>REGIONS.map((region,ri)=>({product,region,weight:[.36,.32,.32][pi]*[.31,.33,.36][ri]*marketSignal(market,month,product.id,region.id)})));
    let roll=Math.random()*pairs.reduce((sum,pair)=>sum+pair.weight,0),picked=pairs[0];for(const pair of pairs){roll-=pair.weight;if(roll<=0){picked=pair;break}}
    const {product,region}=picked,signal=marketSignal(market,month,product.id,region.id);
    const qty=Math.max(2,Math.round((2+Math.random()*5)*Math.sqrt(signal)));
    const playerQty=Math.max(1,Math.round(qty*Math.pow(product.price/playerPrices[product.id],market.elasticity[product.id])));
    const agentQty=Math.max(1,Math.round(qty*Math.pow(product.price/agentPrices[product.id],market.elasticity[product.id])));
    const pInv=cloneInventory(playerRef.current),aInv=cloneInventory(agentRef.current);
    const pOK=pInv[product.id][region.id]>=playerQty,aOK=aInv[product.id][region.id]>=agentQty;
    if(pOK)pInv[product.id][region.id]-=playerQty;if(aOK)aInv[product.id][region.id]-=agentQty;
    playerRef.current=pInv;agentRef.current=aInv;setPlayerInv(pInv);setAgentInv(aInv);
    if(pOK)setPlayerRevenue(v=>v+playerQty*playerPrices[product.id]);if(aOK)setAgentRevenue(v=>v+agentQty*agentPrices[product.id]);
    pOK?setPlayerFilled(v=>v+1):setPlayerMissed(v=>v+1);aOK?setAgentFilled(v=>v+1):setAgentMissed(v=>v+1);
    const next=cloneInventory(demandRef.current);next[product.id][region.id]+=qty;demandRef.current=next;setMonthDemand(next);
    setOrders(prev=>[{id:orderId.current++,product:product.id,region:region.id,qty,playerQty,agentQty,playerPrice:playerPrices[product.id],agentPrice:agentPrices[product.id],playerFilled:pOK,agentFilled:aOK},...prev].slice(0,7));setOrderCount(v=>v+1);
    setFlashRegion(region.id);setTimeout(()=>setFlashRegion(''),420);
  },[screen,phase,month,playerPrices,agentPrices,market]);

  const beginMonth=()=>{
    if(phase!=='planning')return;
    const pInv=cloneInventory(playerRef.current),aInv=cloneInventory(agentRef.current);let pCost=0,aCost=0;
    PRODUCTS.forEach(p=>REGIONS.forEach(r=>{const pq=playerPlan[p.id][r.id],aq=agentPlan[p.id][r.id];pInv[p.id][r.id]+=pq;aInv[p.id][r.id]+=aq;pCost+=pq*p.cost;aCost+=aq*p.cost}));
    playerRef.current=pInv;agentRef.current=aInv;setPlayerInv(pInv);setAgentInv(aInv);setPlayerInventoryCost(v=>v+pCost);setAgentInventoryCost(v=>v+aCost);
    setPlayerPrices({...playerPricePlan});setAgentPrices({...agentPricePlan});setOrders([]);setSeconds(MONTH_SECONDS);closingRef.current=false;setPhase('live');
  };

  const endMonth=useCallback(()=>{
    const pInv=cloneInventory(playerRef.current),aInv=cloneInventory(agentRef.current);
    const pHolding=Object.values(pInv).flatMap(Object.values).reduce((a,b)=>a+b,0)*.45,aHolding=Object.values(aInv).flatMap(Object.values).reduce((a,b)=>a+b,0)*.45;
    setPlayerStorageCost(v=>v+pHolding);setAgentStorageCost(v=>v+aHolding);
    const completed=[...historyRef.current,cloneInventory(demandRef.current)];historyRef.current=completed;
    setDemandHistory(completed);
    setLastAgentPlan(agentPlan);setLastAgentPrices(agentPricePlan);setPhase('review');closingRef.current=false;
  },[agentPlan,agentPricePlan]);

  useEffect(()=>{if(phase!=='live'||screen!=='game')return;const id=setInterval(generateOrder,1600/speed);return()=>clearInterval(id)},[phase,screen,speed,generateOrder]);
  useEffect(()=>{if(phase!=='live'||screen!=='game')return;const id=setInterval(()=>setSeconds(s=>{if(s<=1&&!closingRef.current){closingRef.current=true;setTimeout(endMonth,0);return 0}return Math.max(0,s-1)}),1000/speed);return()=>clearInterval(id)},[phase,screen,speed,endMonth]);

  const nextMonth=()=>{if(month>=12){setScreen('results');return}const next=month+1,blank=emptyInventory(0);demandRef.current=blank;setMonthDemand(blank);setPlayerPlan(emptyInventory(0));setAgentPlan(agentPlanFor(historyRef.current,agentRef.current,next));setAgentPricePlan(agentPricesFor(historyRef.current,agentRef.current,next));setMonth(next);setSeconds(MONTH_SECONDS);setPhase('planning')};
  const reset=()=>{const p=emptyInventory(0),a=emptyInventory(0),d=emptyInventory(0),nextMarket=createMarketProfile(Math.floor(Math.random()*1_000_000_000));playerRef.current=p;agentRef.current=a;demandRef.current=d;historyRef.current=[];closingRef.current=false;setMarket(nextMarket);setPlayerInv(p);setAgentInv(a);setMonthDemand(d);setDemandHistory([]);setShowLedger(false);setPlayerPlan(initialPlan());setAgentPlan(agentPlanFor([],a,1));setLastAgentPlan(emptyInventory(0));setPlayerPrices(basePrices());setAgentPrices(basePrices());setPlayerPricePlan(basePrices());setAgentPricePlan(agentPricesFor([],a,1));setLastAgentPrices(basePrices());setMonth(1);setSeconds(MONTH_SECONDS);setOrders([]);setOrderCount(0);setPlayerRevenue(0);setAgentRevenue(0);setPlayerInventoryCost(0);setAgentInventoryCost(0);setPlayerStorageCost(0);setAgentStorageCost(0);setPlayerFilled(0);setAgentFilled(0);setPlayerMissed(0);setAgentMissed(0);setPhase('planning');setScreen('game')};
  const start=()=>{window.scrollTo({top:0,left:0});setMarket(createMarketProfile(Math.floor(Math.random()*1_000_000_000)));setScreen('game');setPhase('planning')};
  const changePlan=(region:string,delta:number)=>{if(phase!=='planning')return;const p=PRODUCTS.find(x=>x.id===selected)!;setPlayerPlan(prev=>{const next=cloneInventory(prev),used=Object.values(next[selected]).reduce((a,b)=>a+b,0);if(delta>0&&used+delta>p.supply)return prev;next[selected][region]=Math.max(0,next[selected][region]+delta);return next})};
  const useForecast=()=>{if(phase!=='planning')return;const p=PRODUCTS.find(x=>x.id===selected)!,signals=REGIONS.map(r=>publicForecast(selected,r.id)),total=signals.reduce((a,b)=>a+b,0);setPlayerPlan(prev=>{const next=cloneInventory(prev);let used=0;REGIONS.forEach((r,i)=>{const q=i===2?p.supply-used:Math.round(p.supply*signals[i]/total);next[selected][r.id]=q;used+=q});return next})};
  const changePrice=(value:number)=>{if(phase==='planning')setPlayerPricePlan(prev=>({...prev,[selected]:value}))};
  const product=PRODUCTS.find(p=>p.id===selected)!,planUsed=Object.values(playerPlan[selected]).reduce((a,b)=>a+b,0);
  const demandFor=(inv:Inventory,productId:string)=>Object.values(inv[productId]).reduce((a,b)=>a+b,0);
  const ledgerMonths=phase==='review'?demandHistory:[...demandHistory,cloneInventory(monthDemand)];
  const pRate=orderCount?playerFilled/orderCount*100:100,aRate=orderCount?agentFilled/orderCount*100:100;
  const playerProfit=playerRevenue-playerInventoryCost-playerStorageCost,agentProfit=agentRevenue-agentInventoryCost-agentStorageCost;
  const pStock=Object.values(playerInv).flatMap(Object.values).reduce((a,b)=>a+b,0),aStock=Object.values(agentInv).flatMap(Object.values).reduce((a,b)=>a+b,0);
  const model=modelForecast(historyRef.current,selected,'east',month),running=phase==='live',locked=phase!=='planning';
  const observedTotals=demandHistory.map(inv=>demandFor(inv,selected)),observedChange=observedTotals.length>1?Math.round((observedTotals.at(-1)!/Math.max(1,observedTotals[0])-1)*100):0;
  const observedRegion=REGIONS.map(r=>({name:r.name,total:demandHistory.reduce((sum,inv)=>sum+inv[selected][r.id],0)})).sort((a,b)=>b.total-a.total)[0];
  const observedClue=demandHistory.length<2?'Not enough history yet—the hidden market is still a mystery.':`${product.name} demand is ${observedChange>=0?'up':'down'} ${Math.abs(observedChange)}% since the first month; ${observedRegion.name} is currently strongest.`;

  if(screen==='intro')return <Intro onStart={start}/>;
  if(screen==='results')return <Results playerProfit={playerProfit} agentProfit={agentProfit} playerRevenue={playerRevenue} agentRevenue={agentRevenue} playerInventoryCost={playerInventoryCost} agentInventoryCost={agentInventoryCost} playerStorageCost={playerStorageCost} agentStorageCost={agentStorageCost} playerRate={pRate} agentRate={aRate} playerMissed={playerMissed} agentMissed={agentMissed} onRestart={reset}/>;
  return <main className="rt-game">
    <header className="rt-top"><div className="game-logo"><span>SS</span><div><strong>SUPPLYSHIFT</strong><small>MONTHLY AI CHALLENGE</small></div></div><div className="week-track"><span>{MONTHS[month-1]} · {month}/12</span><div><i style={{width:`${month/12*100}%`}}></i></div><b>{seasonFor(month).emoji} {seasonFor(month).name}</b></div><div className="rt-clock"><small>{phase==='planning'?'PLANNING PHASE':phase==='live'?'ORDERS ACTIVE':'MONTH COMPLETE'}</small><strong>{phase==='live'?`00:${String(seconds).padStart(2,'0')}`:phase==='planning'?'PLAN':'DONE'}</strong><span className={`phase-light ${phase}`}>{phase==='planning'?'1':phase==='live'?'2':'3'}</span></div></header>
    <section className="race-strip"><Score who="YOU" profit={playerProfit} revenue={playerRevenue} inventoryCost={playerInventoryCost} storageCost={playerStorageCost} rate={pRate} stock={pStock} color="#5b4cf0"/><div className="versus"><span>PROFIT</span><strong>VS</strong><small>{orderCount} ORDERS</small></div><Score who="MIRA AI" profit={agentProfit} revenue={agentRevenue} inventoryCost={agentInventoryCost} storageCost={agentStorageCost} rate={aRate} stock={aStock} color="#ff5f7e" ai/></section>
    <section className="rt-layout">
      <aside className="orders-panel"><div className="fun-head"><div><small>{phase==='planning'?'ORDERS WAIT UNTIL YOU START':phase==='live'?'RANDOM ORDERS EVERY 1.6 SEC':'MONTH CLOSED'}</small><strong>LIVE ORDER FEED</strong></div><i className={running?'blink':''}></i></div><button className="generate" onClick={generateOrder} disabled={!running}>⚡ GENERATE RANDOM ORDER</button><button className="ledger-btn" onClick={()=>setShowLedger(true)}>📊 MONTHLY + YTD DEMAND</button><div className="demand-mini">{PRODUCTS.map(p=><span key={p.id}><i>{p.emoji}</i><b>{demandFor(monthDemand,p.id)}</b><small>{MONTHS[month-1]}</small></span>)}</div><div className="order-feed">{orders.length===0&&<div className="empty-orders">{phase==='planning'?'Finish your stock and price plan, then start the month.':'Waiting for the first customer…'}</div>}{orders.map(o=>{const p=PRODUCTS.find(x=>x.id===o.product)!,r=REGIONS.find(x=>x.id===o.region)!;return <article key={o.id} style={{'--order':p.color} as React.CSSProperties}><span>{p.emoji}</span><div><strong>{o.qty} market demand · {p.name}</strong><small>{r.city} · YOU {o.playerQty} @ ${o.playerPrice} · AI {o.agentQty} @ ${o.agentPrice}</small></div><b className={o.playerFilled?'filled':'missed'}>{o.playerFilled?'✓ YOU':'✕ YOU'}</b><b className={o.agentFilled?'filled':'missed'}>{o.agentFilled?'✓ AI':'✕ AI'}</b></article>})}</div><div className="feed-stats"><span><b>{playerMissed}</b>Your stockouts</span><span><b>{agentMissed}</b>AI stockouts</span></div></aside>
      <section className="game-world"><div className="world-title"><div><small>MONTH {month} · {phase==='planning'?'PLANNING':phase==='live'?'LIVE OPERATIONS':'REVIEW'}</small><strong>{phase==='planning'?'Orders are paused while both competitors plan':phase==='live'?'Three warehouses · one evolving market':'Demand has stopped for this month'}</strong></div><div className="model-badge">🧬 SCENARIO #{String(market.seed%1_000_000).padStart(6,'0')}</div></div><div className="world-scene"><img src="/warehouse-world-v3.png" alt="Colorful real-time warehouse network"/>{REGIONS.map((r,i)=><div key={r.id} className={`region-pin pin-${r.id} ${flashRegion===r.id?'flash':''}`}><header style={{background:r.color}}><span>{i+1}</span><div><strong>{r.name}</strong><small>{r.city}</small></div></header><div><span>YOU <b>{playerInv[selected][r.id]}</b></span><span>AI <b>{agentInv[selected][r.id]}</b></span></div><small>{product.emoji} {product.name}</small></div>)}<div className={`runner runner-a ${running?'run':''}`}>🚚<span>ORDER</span></div><div className={`runner runner-b ${running?'run':''}`}>📦</div><div className={`runner runner-c ${running?'run':''}`}>🚜</div><div className="mira-bubble"><div className="mira-face"></div><p><strong>MIRA:</strong> {phase==='planning'?`I’ve forecast ${model.point} East units with ${model.confidence}% confidence. I’m learning this market too.`:`I planned safety stock for ${model.safety} units of uncertainty.`}</p></div></div><div className="ticker"><span>HIDDEN MARKET DNA</span><p>Growth · seasonality · demographics · price sensitivity · adoption curves · demand shocks</p></div></section>
      <aside className="plan-panel"><div className="fun-head"><div><small>{phase==='planning'?`PLAN ${MONTHS[month-1]}`:phase==='live'?`${MONTHS[month-1]} IN PROGRESS`:'MONTH COMPLETE'}</small><strong>INVENTORY + PRICE</strong></div><span className={locked?'locked':''}>{phase==='planning'?'YOUR TURN':phase==='live'?'RUNNING':'REVIEW'}</span></div><div className="panel-scroll-hint" aria-hidden="true"><span>MORE CONTROLS BELOW</span><b>SCROLL ↓</b></div><div className="product-switch">{PRODUCTS.map(p=><button key={p.id} onClick={()=>setSelected(p.id)} className={selected===p.id?'active':''} style={{'--p':p.color} as React.CSSProperties}><i>{p.emoji}</i><span>{p.name}</span></button>)}</div><div className="market-clue"><b>🔎 OBSERVED SIGNAL</b><p>{observedClue}</p></div><div className="price-plan"><header><span>{MONTHS[month-1]} SELLING PRICE</span><small>Base ${product.price}</small></header><div><strong>${playerPricePlan[selected]}</strong><input type="range" min={Math.round(product.price*.8)} max={Math.round(product.price*1.32)} value={playerPricePlan[selected]} onChange={e=>changePrice(Number(e.target.value))} disabled={locked}/></div><footer><span>MORE ORDERS</span><span>MORE MARGIN</span><b>AI LAST: {month===1?'HIDDEN':`$${lastAgentPrices[selected]}`}</b></footer></div><div className="ai-stack"><header><span>🧠 MIRA EXPERT ENSEMBLE</span><b>{model.confidence}% confidence</b></header><div><i>EXP SMOOTH</i><i>HOLT TREND</i><i>SEASONAL</i><i>PRICE ELASTICITY</i><i>SAFETY STOCK</i></div></div><div className="supply-box"><span>UNALLOCATED {MONTHS[month-1]} STOCK</span><strong>{product.supply-planUsed}<small> / {product.supply} left</small></strong></div><div className="allocation-list">{REGIONS.map(r=><div key={r.id} className="allocation-row"><header><span style={{background:r.color}}></span><div><strong>{r.name}</strong><small>Forecast {publicForecast(selected,r.id)} units</small></div><b>AI: {month===1?'HIDDEN':`LAST ${lastAgentPlan[selected][r.id]}`}</b></header><div><button onClick={()=>changePlan(r.id,-5)} disabled={locked}>−</button><strong>{playerPlan[selected][r.id]}</strong><button onClick={()=>changePlan(r.id,5)} disabled={locked}>+</button><span className="forecast-bar"><i style={{width:`${Math.min(100,publicForecast(selected,r.id)/45*100)}%`,background:r.color}}></i></span></div></div>)}</div><button className="forecast-btn" onClick={useForecast} disabled={locked}>✨ AUTO-ALLOCATE FROM FORECAST</button><button className={`lock-btn ${locked?'done':''}`} onClick={beginMonth} disabled={locked}>{phase==='planning'?`START ${MONTHS[month-1]} ORDERS ▶`:phase==='live'?'✓ PLAN LOCKED':'MONTH COMPLETE'}</button><p className="plan-help">Every new game has different hidden demand rules. You and Mira see the same orders and must infer the pattern.</p></aside>
    </section>
    <footer className="rt-bottom"><span><b>{phase==='planning'?'STEP 1 · PLAN':phase==='live'?'STEP 2 · LIVE ORDERS':'STEP 3 · REVIEW'}</b> {phase==='planning'?'Nothing moves until you press Start':phase==='live'?'Your decisions are locked for 45 seconds':'Review demand before the next plan'}</span><div className="legend-pill"><i>🎧</i> ${playerPrices.pulse}<i>⌚</i> ${playerPrices.orbit}<i>🔊</i> ${playerPrices.boom}</div><div className="speed"><span>ORDER PACE</span><button className={speed===1?'active':''} onClick={()=>setSpeed(1)}>CALM</button><button className={speed===1.5?'active':''} onClick={()=>setSpeed(1.5)}>BRISK</button></div></footer>
    {phase==='review'&&<div className="month-review"><section><span className="review-kicker">{MONTHS[month-1]} COMPLETE · STEP 3 OF 3</span><h2>Demand by product and region</h2><p>Orders are paused. Compare where each item was requested before planning the next month.</p><div className="review-matrix"><div className="matrix-head"><b>PRODUCT</b>{REGIONS.map(r=><b key={r.id} style={{color:r.color}}>{r.name}</b>)}<b>TOTAL</b></div>{PRODUCTS.map(p=><div className="matrix-row" key={p.id}><strong><i>{p.emoji}</i>{p.name}</strong>{REGIONS.map(r=><span key={r.id}>{monthDemand[p.id][r.id]}</span>)}<b>{demandFor(monthDemand,p.id)}</b></div>)}</div><div className="review-score"><span><small>YOUR YTD PROFIT</small><b>{playerProfit<0?'−':''}${Math.abs(playerProfit).toLocaleString(undefined,{maximumFractionDigits:0})}</b></span><em>VS</em><span><small>MIRA YTD PROFIT</small><b>{agentProfit<0?'−':''}${Math.abs(agentProfit).toLocaleString(undefined,{maximumFractionDigits:0})}</b></span></div><button onClick={nextMonth}>{month>=12?'SEE YEAR-END WINNER':`PLAN ${MONTHS[month]} →`}</button><button className="review-ledger" onClick={()=>setShowLedger(true)}>VIEW FULL DEMAND HISTORY</button></section></div>}
    {showLedger&&<div className="ledger-overlay" onClick={()=>setShowLedger(false)}><section className="ledger-modal" onClick={e=>e.stopPropagation()}><header><div><small>LIVE MARKET INTELLIGENCE</small><h2>Demand by month and region</h2><p>Every product is split into West, Central, and East demand, with a year-to-date total for each region.</p></div><button onClick={()=>setShowLedger(false)} aria-label="Close demand history">×</button></header><div className="ledger-scroll"><table><thead><tr><th>ITEM</th><th>REGION</th>{MONTHS.map((name,i)=><th key={name} className={i===month-1?'current':''}>{name}</th>)}<th>YTD</th></tr></thead><tbody>{PRODUCTS.flatMap(p=>REGIONS.map(r=>{const ytd=ledgerMonths.reduce((sum,inv)=>sum+inv[p.id][r.id],0);return <tr key={`${p.id}-${r.id}`}><th><span>{p.emoji}</span>{p.name}</th><th className="ledger-region"><i style={{background:r.color}}></i>{r.name}</th>{MONTHS.map((name,i)=><td key={name} className={i===month-1?'current':''}>{i<ledgerMonths.length?ledgerMonths[i][p.id][r.id]:'—'}</td>)}<td className="ytd">{ytd}</td></tr>}))}</tbody></table></div><footer><span><i></i> {MONTHS[month-1]} is updating live</span><b>{ledgerMonths.reduce((grand,inv)=>grand+PRODUCTS.reduce((sum,p)=>sum+demandFor(inv,p.id),0),0)} total units ordered this year</b></footer></section></div>}
  </main>
}

function Score({who,profit,revenue,inventoryCost,storageCost,rate,stock,color,ai=false}:{who:string;profit:number;revenue:number;inventoryCost:number;storageCost:number;rate:number;stock:number;color:string;ai?:boolean}){return <div className={`race-score ${ai?'ai':''}`} style={{'--team':color} as React.CSSProperties}><div className="score-avatar">{ai?'🤖':'🧑‍💼'}</div><div className="score-money"><small>{who} · TOTAL PROFIT</small><strong>{profit<0?'−':''}${Math.abs(profit).toLocaleString(undefined,{maximumFractionDigits:0})}</strong><details className="profit-details"><summary>View breakdown</summary><div><span>${revenue.toLocaleString(undefined,{maximumFractionDigits:0})} earned</span><span>− ${inventoryCost.toLocaleString(undefined,{maximumFractionDigits:0})} inventory</span><span>− ${storageCost.toLocaleString(undefined,{maximumFractionDigits:0})} storage</span></div></details></div><span><b>{rate.toFixed(0)}%</b> filled</span><span><b>{stock}</b> units</span></div>}
function Intro({onStart}:{onStart:()=>void}){return <main className="year-intro"><div className="year-nav"><div className="game-logo"><span>SS</span><div><strong>SUPPLYSHIFT</strong><small>PLAYER vs ADAPTIVE AI</small></div></div><div className="year-badge">MILLIONS OF HIDDEN MARKETS · 12 MONTHS · EXPERT AI</div></div><div className="year-world"><img src="/warehouse-world-v3.png" alt="Colorful three-zone warehouse game world"/><div className="order-pop pop-a">📈 HIDDEN GROWTH CURVE</div><div className="order-pop pop-b">🌎 REGIONAL DEMOGRAPHICS</div><div className="order-pop pop-c">💸 PRICE SENSITIVITY + SEASONS</div></div><section className="year-copy"><span className="kicker">A DIFFERENT MARKET EVERY GAME</span><h1>Find the pattern.<br/><em>Beat the machine.</em></h1><p>A hidden market is generated for the year. Product trends, seasons, price sensitivity, regional tastes, adoption waves, and demand shocks shape every order. You and Mira must learn it month by month.</p><div className="game-rules"><span><b>1</b> Plan</span><span><b>2</b> Observe</span><span><b>3</b> Learn</span></div><button className="big-play" onClick={onStart}>GENERATE A MARKET <span>▶</span></button></section></main>}
function Results({playerProfit,agentProfit,playerRevenue,agentRevenue,playerInventoryCost,agentInventoryCost,playerStorageCost,agentStorageCost,playerRate,agentRate,playerMissed,agentMissed,onRestart}:{playerProfit:number;agentProfit:number;playerRevenue:number;agentRevenue:number;playerInventoryCost:number;agentInventoryCost:number;playerStorageCost:number;agentStorageCost:number;playerRate:number;agentRate:number;playerMissed:number;agentMissed:number;onRestart:()=>void}){const won=playerProfit>agentProfit;return <main className="results-screen"><div className="confetti">✦　●　★　◆　✦　●　★</div><section><span className="year-complete">12 MONTHS COMPLETE</span><h1>{won?'YOU BEAT EXPERT MIRA!':'MIRA’S ENSEMBLE WINS'}</h1><p>The winner has the highest profit: money earned minus inventory and storage costs.</p><div className="final-race"><div className={won?'winner':''}><span>🧑‍💼</span><small>YOUR COMPANY · PROFIT</small><strong>${playerProfit.toLocaleString(undefined,{maximumFractionDigits:0})}</strong><p className="result-formula">${playerRevenue.toLocaleString(undefined,{maximumFractionDigits:0})} earned<br/>− ${playerInventoryCost.toLocaleString(undefined,{maximumFractionDigits:0})} inventory<br/>− ${playerStorageCost.toLocaleString(undefined,{maximumFractionDigits:0})} storage</p><p>{playerRate.toFixed(1)}% filled · {playerMissed} stockouts</p></div><b>VS</b><div className={!won?'winner':''}><span>🤖</span><small>MIRA ENSEMBLE · PROFIT</small><strong>${agentProfit.toLocaleString(undefined,{maximumFractionDigits:0})}</strong><p className="result-formula">${agentRevenue.toLocaleString(undefined,{maximumFractionDigits:0})} earned<br/>− ${agentInventoryCost.toLocaleString(undefined,{maximumFractionDigits:0})} inventory<br/>− ${agentStorageCost.toLocaleString(undefined,{maximumFractionDigits:0})} storage</p><p>{agentRate.toFixed(1)}% filled · {agentMissed} stockouts</p></div></div><button className="big-play" onClick={onRestart}>PLAY ANOTHER YEAR <span>↻</span></button></section></main>}
