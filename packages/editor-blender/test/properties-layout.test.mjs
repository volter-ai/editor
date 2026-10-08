import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const directory=fileURLToPath(new URL('../contributions/',import.meta.url));
const bundle=await build({
  stdin:{contents:`export {default as ObjectSection} from './properties-object.inspector';
    export {default as SceneSection, railDefault} from './properties-scene.inspector';`,resolveDir:directory},
  bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime','@fortawesome/free-solid-svg-icons'],
  plugins:[{name:'live-rna-fixture',setup(build){
    build.onResolve({filter:/blender-properties-model$|^@volter\/sdk\/widgets$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.includes('widgets')
      ? `import {createElement} from 'react';
         export const EditorIcon=({icon})=>createElement('span',{'data-icon':icon.iconName});
         export const ColorPicker=()=>null,hexToRgb=()=>[],parseAlpha=()=>1,toHex=x=>x;`
      : `export const blenderPropertiesState=()=>probe.state,
         blenderPropertiesVersion=()=>1, subscribeBlenderProperties=()=>()=>{},
         blenderRnaViewFor=()=>probe.view, showBlenderSubject=()=>{},
         resolveBlenderSubject=()=>probe.subject, writeBlenderRnaProperty=()=>{};`}));
  }}],
});
function row(identifier,value,type='FLOAT',subtype='XYZ'){
  return {identifier,name:identifier,type,subtype,value,arrayLength:Array.isArray(value)?value.length:0,
    readonly:false,description:'',group:'Object',groupName:'Object'};
}
function fixture(rows,kind='object'){
  const probe={subject:{kind,name:'Cube'},state:{error:null,loading:false,context:{engine:'BLENDER_EEVEE',tabs:[
    {id:'object',paths:[{label:'Object',path:'object'}]},
    {id:'scene',paths:[{label:'Scene',path:'scene'}]},
  ]}},view:{kind:'struct',type:'Object',groups:[{rows}]}};
  const module={exports:{}};
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),probe});
  return {api:module.exports,probe};
}

for(const mode of ['XYZ','QUATERNION','AXIS_ANGLE'])test(`Transform draws only ${mode}'s rotation channel with adjacent locks`,()=>{
  const {api}=fixture([
    row('location',[0,0,0]),row('lock_location',[false,false,false],'BOOLEAN'),
    row('rotation_euler',[0,0,0],'FLOAT','EULER'),
    row('rotation_quaternion',[1,0,0,0],'FLOAT','QUATERNION'),
    row('rotation_axis_angle',[0,0,0,1],'FLOAT','AXISANGLE'),
    row('lock_rotation_w',false,'BOOLEAN'),row('lock_rotation',[false,false,false],'BOOLEAN'),
    row('rotation_mode',mode,'ENUM'),row('scale',[1,1,1]),row('lock_scale',[false,false,false],'BOOLEAN'),
    row('delta_location',[0,0,0]),row('delta_scale',[1,1,1]),
  ]);
  const html=renderToStaticMarkup(createElement(api.ObjectSection,{node:null,adapter:{}}));
  const channel=mode==='XYZ'?'rotation_euler':mode==='QUATERNION'?'rotation_quaternion':'rotation_axis_angle';
  assert.match(html,new RegExp(`data-rna-field="${channel}\\[0\\]"`));
  for(const other of ['rotation_euler','rotation_quaternion','rotation_axis_angle'].filter(name=>name!==channel))
    assert.ok(!html.includes(`data-rna-field="${other}[`));
  assert.equal((html.match(/aria-pressed="false"/g)??[]).length,mode==='XYZ'?9:10);
  assert.ok(!html.includes('data-rna-field="lock_location['));
  assert.match(html,/data-field-label="Mode"/);
  assert.ok(html.includes('Delta Transform'));
});

test('Scene fallback is subject-dependent and Gravity keeps its header checkbox when collapsed',()=>{
  const {api,probe}=fixture([row('use_gravity',true,'BOOLEAN'),row('gravity',[0,0,-9.81])],'scene');
  assert.equal(api.railDefault(null,{}),true);
  probe.subject={kind:'object',name:'Cube'};
  assert.equal(api.railDefault(null,{}),false);
  probe.subject={kind:'scene'};
  const html=renderToStaticMarkup(createElement(api.SceneSection,{node:null,adapter:{}}));
  assert.match(html,/aria-label="use_gravity"[^>]*checked=""/);
  assert.ok(!html.includes('data-rna-field="gravity['));
});
