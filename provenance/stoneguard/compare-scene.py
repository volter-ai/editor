import array, base64, json, math, pathlib, sqlite3, sys

def load(path):
    db = sqlite3.connect(str(path)+'.sqlite')
    db.executescript('DROP TABLE IF EXISTS arrays; CREATE TABLE arrays(mesh TEXT, field TEXT, kind TEXT, sha TEXT, data BLOB, PRIMARY KEY(mesh,field));')
    objects = {}; done = None
    with open(path) as f:
        for line in f:
            if line.startswith('@@SCENE_ARRAY '):
                r=json.loads(line.split(' ',1)[1]); db.execute('INSERT INTO arrays VALUES(?,?,?,?,?)',(r['mesh'],r['field'],r['kind'],r['sha256'],base64.b64decode(r['bytes'])))
            elif line.startswith('@@SCENE_OBJECT '):
                r=json.loads(line.split(' ',1)[1]); objects[r['name']]=r
            elif line.startswith('@@SCENE_DONE '): done=json.loads(line.split(' ',1)[1])
    db.commit()
    if not done: raise RuntimeError('Incomplete scene evidence: '+str(path))
    return db,objects,done

a,ao,ad=load(sys.argv[1]); b,bo,bd=load(sys.argv[2])
report={'left':ad,'right':bd,'objectNamesExact':ao.keys()==bo.keys(),'objectMismatches':[], 'matrixMaxAbs':0, 'fields':{}}
pairs=set()
for name in ao.keys() & bo.keys():
    x,y=ao[name],bo[name]
    if (x['type'],x['vertices'],bool(x['mesh']))!=(y['type'],y['vertices'],bool(y['mesh'])): report['objectMismatches'].append(name)
    report['matrixMaxAbs']=max(report['matrixMaxAbs'],max(abs(u-v) for u,v in zip(x['matrix'],y['matrix'])))
    if x['mesh'] and y['mesh']: pairs.add((x['mesh'],y['mesh']))
for left,right in sorted(pairs):
    aa={r[0]:r[1:] for r in a.execute('SELECT field,kind,sha,data FROM arrays WHERE mesh=?',(left,))}
    bb={r[0]:r[1:] for r in b.execute('SELECT field,kind,sha,data FROM arrays WHERE mesh=?',(right,))}
    if aa.keys()!=bb.keys(): report['objectMismatches'].append({'mesh':left,'fieldsLeft':list(aa),'fieldsRight':list(bb)})
    for field in aa.keys() & bb.keys():
        kind,sha,raw=aa[field]; kind2,sha2,raw2=bb[field]
        out=report['fields'].setdefault(field,{'pairs':0,'exact':0,'different':0,'shapeMismatch':0,'maxAbs':0,'sumSquared':0,'values':0,'worstMesh':None})
        out['pairs']+=1
        if kind!=kind2 or len(raw)!=len(raw2):out['shapeMismatch']+=1;continue
        out['values']+=len(raw)//4
        if sha==sha2:out['exact']+=1;continue
        out['different']+=1
        av=array.array(kind);av.frombytes(raw);bv=array.array(kind);bv.frombytes(raw2)
        maximum=0; squared=0
        for u,v in zip(av,bv):
            delta=abs(u-v); maximum=max(maximum,delta);squared+=delta*delta
        if maximum>out['maxAbs']:out['maxAbs']=maximum;out['worstMesh']=left
        out['sumSquared']+=squared
for out in report['fields'].values():out['rms']=math.sqrt(out.pop('sumSquared')/max(out['values'],1))
report['meshPairs']=len(pairs)
print(json.dumps(report,indent=2,sort_keys=True))
