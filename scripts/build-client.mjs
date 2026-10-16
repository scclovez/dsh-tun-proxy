import { readFileSync, writeFileSync } from 'node:fs'
const panelStyle = readFileSync(new URL('../lib/panel-style.js', import.meta.url), 'utf8').replace('export const PANEL_CSS', 'const PANEL_CSS')
const select = readFileSync(new URL('../lib/select.js', import.meta.url), 'utf8').replace('export function enhanceSelects', 'function enhanceSelects')
const panel = readFileSync(new URL('../lib/panel.js', import.meta.url), 'utf8').replace("import { PANEL_CSS } from './panel-style.js'", '').replace("import { enhanceSelects } from './select.js'", '').replace('export function mountPanel', 'function mountPanel')
const client = `window.__ModuleLoader__.load({id:'dsh-tun-proxy',factory(require){
const React=require('react');
${panelStyle}
${select}
${panel}
const schema={parse(value){if(typeof value!=='string')throw new Error('Expected JSON string');return value}};
const codec={mode:'strict',typeSymbol:'dsh-tun-proxy#JSON',schema,create:()=>schema};
const descriptor={id:'dsh-tun-proxy#tunProxy/invoke',service:'tunProxy',namespace:'tunProxy',method:'invoke',invocation:{kind:'direct'},parameters:[{name:'payload',wire:'payload',source:'json',codec}],result:codec};
function Page(props){const ref=React.useRef(null);React.useEffect(()=>mountPanel(ref.current,props.call,props.back),[props.call,props.back]);return React.createElement('div',{ref,style:{height:'100%',minHeight:0,flex:1}})}
return {inject:['slots','remote','layout'],apply(ctx){
const mount=ctx.remote.$mount({package:'dsh-tun-proxy',descriptors:[descriptor]});
const call=async(action,data={})=>{await mount;const response=await ctx.get('remote.tunProxy').invoke(JSON.stringify({...data,action}));if(!response.ok)throw new Error(response.error?.message||'DSH connection failed');const result=JSON.parse(response.value);if(!result.ok)throw new Error(result.error);return result.result};
const back=()=>ctx.get('layout')?.selectPanel(null);
ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'dsh-proxy-center',order:3,label:()=> '代理中心'},()=>React.createElement('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},React.createElement('circle',{cx:12,cy:12,r:9}),React.createElement('path',{d:'M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18'}))));
ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'dsh-proxy-center',inject:()=>({call,back})},Page));
}};
}});\n`
writeFileSync(new URL('../lib/client.js', import.meta.url), client)
console.log('Built DSH client panel')
