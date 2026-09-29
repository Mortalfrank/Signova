import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { demoAnalyze } from './public/core.js';
import { getModelStatus, analyzeWithModel, ModelError } from './model.mjs';
import { getAsrStatus, attachAsr } from './asr.mjs';

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.mp4':'video/mp4'};
function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
export function createServer({env=process.env, fetchImpl=globalThis.fetch}={}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const model=getModelStatus(env);
        return json(res,200,{mode:model.configured?'model':'demo',model,asr:getAsrStatus(env),sign:'not-configured'});
      }
      if (['/api/analyze','/api/model/check'].includes(url.pathname) && req.method === 'POST') {
        if(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res,403,{error:'不允许跨站请求'});
        let body='';
        for await (const chunk of req) {
          body += chunk.toString();
          if(Buffer.byteLength(body)>128000) return json(res,413,{error:'内容过长，请缩短后重试'});
        }
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'请求格式错误'});}
        if(url.pathname==='/api/model/check') {
          // This explicit test sends synthetic content only, never saved personal records.
          await analyzeWithModel({text:'请问学生服务中心在哪里？',knowledge:'学生服务中心在教学楼一楼。'},{env,fetchImpl});
          return json(res,200,{ok:true,model:getModelStatus(env).model});
        }
        if(!input || typeof input.text!=='string'||!input.text.trim()||input.text.length>4000) return json(res,400,{error:'请输入 1–4000 字的发言'});
        const text=input.text.trim();
        const knowledge=typeof input.knowledge==='string'?input.knowledge.slice(0,12000):'';
        const result=await analyzeWithModel({text,knowledge,memories:input.memories,context:input.context},{env,fetchImpl});
        return json(res,200,{...result,evidence:demoAnalyze(text,knowledge).evidence});
      }
      if(req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'Method not allowed'});
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep)) return json(res,403,{error:'Forbidden'});
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      if(error instanceof ModelError) return json(res,502,{error:error.publicMessage,code:error.code});
      if(error.code==='ENOENT'||error.code==='EISDIR')return json(res,404,{error:'Not found'});
      json(res,500,{error:'处理失败，请重试。服务配置和密钥不会返回客户端。'});
    }
  });
  attachAsr(server,{env});
  return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||5178);
  createServer().listen(port,host,()=>console.log(`SIGNOVA is ready at http://${host}:${port}`));
}
