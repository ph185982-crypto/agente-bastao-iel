const test=require('node:test');
const assert=require('node:assert/strict');
const https=require('https');
const {EventEmitter}=require('events');
const {Readable}=require('stream');
const {safeFetch}=require('./safeFetch');

test('a leitura binária preserva bytes da imagem e a leitura padrão continua como texto',async()=>{
  const original=https.request;
  const dados=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x80,0xfe]);
  https.request=(opts,cb)=>{const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=Readable.from([dados]);res.statusCode=200;res.headers={'content-type':'image/jpeg'};cb(res);});return req;};
  try{
    const r=await safeFetch('https://images.pexels.com/test.jpg',{tipos:[/^image\//],binario:true});
    assert(Buffer.isBuffer(r.corpo));assert.deepEqual(r.corpo,dados);
    const texto=await safeFetch('https://images.pexels.com/test.jpg',{tipos:[/^image\//]});assert.equal(typeof texto.corpo,'string');
  }finally{https.request=original;}
});
