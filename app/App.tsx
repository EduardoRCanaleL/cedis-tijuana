'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

const ROLE_BG    = { CE:'#E6F1FB', ALM:'#E1F5EE', PROD:'#EEEDFE', DISC:'#FCEBEB' }
const ROLE_TEXT  = { CE:'#0C447C', ALM:'#085041', PROD:'#3C3489', DISC:'#A32D2D' }
const ROLE_COLOR = { CE:'#185FA5', ALM:'#0F6E56', PROD:'#534AB7', DISC:'#A32D2D' }

function Badge({ color, children }: { color: string, children: React.ReactNode }) {
  const m: Record<string,{bg:string,tx:string}> = {
    blue:  {bg:'#E6F1FB',tx:'#0C447C'}, green: {bg:'#EAF3DE',tx:'#3B6D11'},
    amber: {bg:'#FAEEDA',tx:'#854F0B'}, red:   {bg:'#FCEBEB',tx:'#A32D2D'},
    gray:  {bg:'#F1EFE8',tx:'#444441'}, purple:{bg:'#EEEDFE',tx:'#3C3489'},
    teal:  {bg:'#E1F5EE',tx:'#085041'}, coral: {bg:'#FAECE7',tx:'#712B13'},
  }
  const c = m[color] || m.gray
  return <span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:500,background:c.bg,color:c.tx}}>{children}</span>
}

function Btn({ onClick, variant='primary', children, disabled, small, style={} }: any) {
  const vs: Record<string,any> = {
    primary:   {background:'#1a1a1a', color:'#fff',    border:'none'},
    secondary: {background:'#f0f0f0', color:'#1a1a1a', border:'1px solid #ddd'},
    danger:    {background:'#FCEBEB', color:'#A32D2D', border:'none'},
    amber:     {background:'#FAEEDA', color:'#854F0B', border:'none'},
    teal:      {background:'#E1F5EE', color:'#085041', border:'none'},
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{padding:small?'4px 10px':'8px 16px',borderRadius:8,fontSize:small?12:13,
        fontWeight:500,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.5:1,
        ...vs[variant],...style}}>
      {children}
    </button>
  )
}

function Input({ label, value, onChange, placeholder, type='text', required, style={} }: any) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4,...style}}>
      {label && <label style={{fontSize:12,color:'#666',fontWeight:500}}>{label}{required&&<span style={{color:'#A32D2D'}}> *</span>}</label>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13,outline:'none',background:'#fff',color:'#1a1a1a'}}/>
    </div>
  )
}

function Table({ cols, rows, emptyMsg='Sin registros' }: any) {
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead>
          <tr style={{borderBottom:'1px solid #eee'}}>
            {cols.map((c:any)=><th key={c.key} style={{padding:'7px 10px',textAlign:'left',color:'#888',fontWeight:500,fontSize:12,whiteSpace:'nowrap'}}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length===0&&<tr><td colSpan={cols.length} style={{padding:20,textAlign:'center',color:'#bbb',fontSize:13}}>{emptyMsg}</td></tr>}
          {rows.map((r:any,i:number)=>(
            <tr key={i} style={{borderBottom:'1px solid #f5f5f5'}}>
              {cols.map((c:any)=><td key={c.key} style={{padding:'7px 10px',whiteSpace:'nowrap'}}>{c.render?c.render(r[c.key],r):(r[c.key]??'—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PARSER — soporta KTC · Changhong · MTC · TCL (MOKA) · HKC
// ─────────────────────────────────────────────────────────────

const isChinese = (s: string) => /[\u4e00-\u9fff]/.test(s)

// Hojas que solo aportan metadatos (no se extraen partes)
const META_ONLY_SHEETS = ['inv','statement','wpm']

const parseSheetName = (name: string) => {
  const t = name.trim()
  const dot = t.match(/^\d+\.([A-Z]{2,6}\d{5,})/i)
  if (dot) return { contenedor: dot[1].toUpperCase(), comentario: null }
  const std = t.match(/^([A-Z]{2,6}\d{5,})/i)
  if (std) return { contenedor: std[1].toUpperCase(), comentario: t.slice(std[1].length).trim() || null }
  return { contenedor: t.toUpperCase(), comentario: null }
}

const norm = (k: string) => k.toLowerCase().replace(/[\s_\-\.\/\(\)#:\n]/g,'')

const FIELD_MAP: Record<string,string[]> = {
  containerCol: ['contianerno','containerno','containerid'],
  piCol:        ['pino','pinumber','plno'],
  cartonRef:    ['carton','ctns','ctn','caja','cno'],
  partNo:       ['partno','partnum','partnumber','part','parte','itemno','item','tpvpartnumber','tpvpart'],
  desc:         ['englishdescription','descriptionofgoods','description','englishdesc','goods','english','descripcion'],
  descCN:       ['chinesedescription','chinese','chinesedesc'],
  qty:          ['quantityofpieces','quantityofpcs','qty','quantity','cantidad','pcs','pieces','totalqty'],
  qtyBox:       ['quantityofbox','qtyofbox','quantitybox','boxqty','cartonqty'],
  qtyPerBox:    ['pcsperbox','perbox'],
  um:           ['unit','unidad','um','uom','unitea'],
  value:        ['unitprice','unitpritce','price','valor','precio'],
  totalAmount:  ['totalamount','totalvalue','totalusd','totalpritce','totalprice'],
  netWeight:    ['totalnetweight','netweight','nw','pesoneto','netwt'],
  grsWeight:    ['totalgrossweight','grossweight','gw','pesobruto','grosswt'],
  cbm:          ['measurement','cbm','volume','m3','volumen','dimension'],
  country:      ['countryoforigin','country','origen','paisorigen'],
}

const KEYWORDS   = ['part','description','qty','quantity','unit','carton','weight','item','desc','goods','pieces','pcs','container']
const SKIP_WORDS = ['total','subtotal','grand','pallet','pallets','totales']

const isSkipRow = (partNo: string, desc: string, cartonVal: string) => {
  const combined = (partNo + ' ' + desc).toLowerCase()
  if (!partNo && !desc) return true
  if (partNo === '0') return true
  if (SKIP_WORDS.some(w => combined.includes(w))) return true
  if (cartonVal && cartonVal.toLowerCase().includes('pallet')) return true
  return false
}

// Parsea fecha — soporta texto ISO y seriales numéricos de Excel
const parseDate = (raw: string): string | null => {
  if (!raw || !raw.trim()) return null
  const serial = Number(raw.trim())
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const d = new Date((serial - 25569) * 86400 * 1000)
    const y = d.getUTCFullYear()
    if (y >= 2020 && y <= 2099)
      return `${y}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  const d = new Date(raw.trim().replace(/\//g,'-'))
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  if (y < 2020 || y > 2099) return null
  return d.toISOString().slice(0,10)
}

// Mapea encabezados a índices de campo
// IMPORTANTE: usa "mark used" para evitar que dos campos reclamen la misma columna.
// Ejemplo: "CARTON QTY" debe ir a qtyBox, no robarle el slot a " QTY" (qty real).
function buildFieldIdx(headers: string[]): Record<string,number> {
  const fieldIdx: Record<string,number> = {}
  const usedCols = new Set<number>()
  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    const idx = headers.findIndex((h, hi) => {
      if (usedCols.has(hi)) return false
      const n = norm(h)
      return aliases.some(a =>
        n === a ||                                      // exact match siempre aplica
        (a.length >= 6 && n.includes(a)) ||            // alias largo: substring en header
        (n.length >= 6 && a.includes(n.slice(0, 8)))   // header largo: substring en alias
      )
    })
    if (idx >= 0) usedCols.add(idx)
    fieldIdx[field] = idx
  }
  return fieldIdx
}

// ── ROLE SELECTOR ─────────────────────────────────────────────
function RoleSelector({ onSelect }: { onSelect: (r:string)=>void }) {
  const roles = [
    {key:'CE',   title:'Comercio Exterior', desc:'Registra PIs, sube Packing Lists, genera manifiestos.'},
    {key:'ALM',  title:'Almacén',           desc:'Recibe mercancía, gestiona inventario y despachos.'},
    {key:'PROD', title:'Producción',        desc:'Solicita materiales por PI, contenedor o parte.'},
    {key:'DISC', title:'Discrepancias',     desc:'Consulta faltantes y exporta reportes a Excel.'},
  ]
  return (
    <div style={{maxWidth:560,margin:'60px auto',padding:'0 20px',fontFamily:'system-ui,sans-serif'}}>
      <div style={{fontSize:22,fontWeight:700,marginBottom:4,color:'#1a1a1a'}}>CEDIS Tijuana</div>
      <div style={{fontSize:14,color:'#888',marginBottom:24}}>Sistema de Control de Operaciones v1</div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {roles.map(r=>(
          <div key={r.key} onClick={()=>onSelect(r.key)}
            style={{padding:18,borderRadius:12,border:`1.5px solid ${ROLE_COLOR[r.key as keyof typeof ROLE_COLOR]}40`,
              background:ROLE_BG[r.key as keyof typeof ROLE_BG],cursor:'pointer',transition:'transform .1s'}}
            onMouseEnter={e=>(e.currentTarget.style.transform='translateX(4px)')}
            onMouseLeave={e=>(e.currentTarget.style.transform='')}>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:ROLE_COLOR[r.key as keyof typeof ROLE_COLOR]}}/>
              <span style={{fontSize:14,fontWeight:600,color:ROLE_TEXT[r.key as keyof typeof ROLE_TEXT]}}>{r.title}</span>
            </div>
            <div style={{fontSize:13,color:'#666'}}>{r.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── VISTA AGRUPADA DE PIs (CE) ────────────────────────────────
function PIsAgrupados({ pis, onGoToFaltantes }: { pis: any[], onGoToFaltantes?: ()=>void }) {
  const [openPIs, setOpenPIs] = useState<Record<string,boolean>>({})

  const grouped: Record<string, {modelo:string, eta:string|null, contenedores:any[]}> = {}
  for (const pi of pis) {
    const parts  = pi.pi_number?.split('-') || []
    const piBase = parts.slice(0,-1).join('-') || pi.pi_number
    if (!grouped[piBase]) grouped[piBase] = { modelo:pi.modelo, eta:pi.eta, contenedores:[] }
    grouped[piBase].contenedores.push(pi)
  }

  if (Object.keys(grouped).length===0)
    return <div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>No hay PIs registrados aún.</div>

  const totalPIs    = Object.keys(grouped).length
  const totalConts  = pis.length
  const totalPiezas = pis.reduce((a,p)=>a+(p._piezas||0),0)
  const totalValor  = pis.reduce((a,p)=>a+(p._valor||0),0)

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
        {[
          {label:'PIs activas',  val:String(totalPIs)},
          {label:'Contenedores', val:String(totalConts)},
          {label:'Piezas totales',val:totalPiezas.toLocaleString()},
          {label:'Valor total',  val:`$${totalValor.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`},
        ].map(m=>(
          <div key={m.label} style={{background:'#f9f9f9',borderRadius:8,padding:'10px 14px'}}>
            <div style={{fontSize:11,color:'#888',marginBottom:2}}>{m.label}</div>
            <div style={{fontSize:18,fontWeight:500,color:m.label==='Valor total'?'#3B6D11':'#1a1a1a'}}>{m.val}</div>
          </div>
        ))}
      </div>
      {Object.entries(grouped).map(([piBase,piData])=>{
        const isOpen    = openPIs[piBase]
        const conts     = piData.contenedores
        const piPiezas  = conts.reduce((a:number,c:any)=>a+(c._piezas||0),0)
        const piValor   = conts.reduce((a:number,c:any)=>a+(c._valor||0),0)
        const pendientes = conts.filter((c:any)=>c.status==='pendiente').length
        const recibidos  = conts.filter((c:any)=>c.status==='recibido').length
        const faltantes  = conts.filter((c:any)=>c.status==='con_faltantes').length
        const statusBadge = faltantes>0
          ? <Badge color="coral">{faltantes} con faltantes</Badge>
          : pendientes===conts.length ? <Badge color="amber">pendiente</Badge>
          : recibidos===conts.length  ? <Badge color="green">todo recibido</Badge>
          : <Badge color="blue">{recibidos}/{conts.length} recibidos</Badge>
        let etaBadge = null
        if (piData.eta) {
          const dias = Math.ceil((new Date(piData.eta).getTime()-Date.now())/86400000)
          const bg   = dias<0?'#FCEBEB':dias<=7?'#FAEEDA':'#E6F1FB'
          const tx   = dias<0?'#A32D2D':dias<=7?'#854F0B':'#0C447C'
          etaBadge = <span style={{padding:'2px 7px',borderRadius:8,fontSize:11,fontWeight:500,background:bg,color:tx}}>
            {dias<0?`hace ${Math.abs(dias)}d`:dias===0?'hoy':`en ${dias}d`}
          </span>
        }
        return (
          <div key={piBase} style={{marginBottom:8,border:'0.5px solid #e0e0e0',borderRadius:10,overflow:'hidden'}}>
            <div onClick={()=>setOpenPIs(s=>({...s,[piBase]:!s[piBase]}))}
              style={{padding:'11px 16px',background:'#f9f9f9',cursor:'pointer',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
              onMouseLeave={e=>e.currentTarget.style.background='#f9f9f9'}>
              <span style={{fontSize:12,color:'#aaa',minWidth:14}}>{isOpen?'▼':'▶'}</span>
              <Badge color="blue">{piBase}</Badge>
              <Badge color="purple">{piData.modelo}</Badge>
              <span style={{fontSize:12,color:'#888'}}>{conts.length} contenedor{conts.length!==1?'es':''}</span>
              {statusBadge}
              <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
                {etaBadge}
                <span style={{fontSize:12,color:'#888'}}>{piPiezas.toLocaleString()} pzas</span>
                <span style={{fontSize:13,fontWeight:500,color:'#3B6D11'}}>${piValor.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>
            </div>
            {isOpen&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1.8fr 0.7fr 0.8fr 1.2fr 1fr 1fr',padding:'6px 16px 6px 40px',borderBottom:'0.5px solid #eee',background:'#fafafa'}}>
                  {['Contenedor','Partes','Piezas','Valor USD','ETA','Estatus'].map(h=>(
                    <span key={h} style={{fontSize:11,color:'#aaa',fontWeight:500}}>{h}</span>
                  ))}
                </div>
                {conts.map((cont:any)=>(
                  <div key={cont.id} style={{display:'grid',gridTemplateColumns:'1.8fr 0.7fr 0.8fr 1.2fr 1fr 1fr',
                    padding:'8px 16px 8px 40px',borderBottom:'0.5px solid #f5f5f5',alignItems:'center',
                    background:cont.status==='con_faltantes'?'#FFFBF5':'transparent'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
                    onMouseLeave={e=>e.currentTarget.style.background=cont.status==='con_faltantes'?'#FFFBF5':'transparent'}>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <Badge color="teal">{cont.contenedor}</Badge>
                      {cont.comentario&&<Badge color="amber">{cont.comentario}</Badge>}
                    </div>
                    <span style={{fontSize:12,color:'#666'}}>{(cont.packing_list_items||[]).length}</span>
                    <span style={{fontSize:12,color:'#666'}}>{(cont._piezas||0).toLocaleString()}</span>
                    <span style={{fontSize:12,color:'#3B6D11',fontWeight:500}}>${(cont._valor||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    <span style={{fontSize:12,color:'#888'}}>{cont.eta||'—'}</span>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <Badge color={cont.status==='pendiente'?'amber':cont.status==='recibido'?'green':'coral'}>
                        {cont.status==='con_faltantes'?'con faltantes':cont.status}
                      </Badge>
                      {cont.status==='con_faltantes'&&onGoToFaltantes&&(
                        <button onClick={e=>{e.stopPropagation();onGoToFaltantes()}}
                          style={{padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:500,
                            cursor:'pointer',background:'#FAECE7',color:'#712B13',border:'none',whiteSpace:'nowrap'}}>
                          Ver faltantes →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── COMERCIO EXTERIOR ─────────────────────────────────────────
function CEView({ onBack, onLogout, onGoToFaltantes, userName, userRol }: { onBack: ()=>void, onLogout?: ()=>void, onGoToFaltantes?: ()=>void, userName?: string, userRol?: string }) {
  const [tab, setTab]             = useState('pis')
  const [pis, setPIs]             = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [preview, setPreview]     = useState<any[]>([])
  const [piNum, setPiNum]         = useState('')
  const [modelo, setModelo]       = useState('')
  const [proveedor, setProveedor] = useState('')
  const [contenedor, setContenedor] = useState('')
  const [eta, setEta]             = useState('')
  const [unidades, setUnidades]   = useState('')
  const [notas, setNotas]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadPIs = async () => {
    const { data } = await supabase
      .from('pis')
      .select('*, packing_list_items(qty_esperada, total_amount)')
      .order('created_at',{ascending:false})
    setPIs((data||[]).map((pi:any)=>({
      ...pi,
      _piezas: (pi.packing_list_items||[]).reduce((s:number,i:any)=>s+(i.qty_esperada||0),0),
      _valor:  (pi.packing_list_items||[]).reduce((s:number,i:any)=>s+(i.total_amount||0),0),
    })))
  }
  useEffect(()=>{ loadPIs() },[])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files||[])
    if (!files.length) return
    setLoading(true)
    try {
      const allSheets: any[] = []
      let dPI='', dModelo='', dProveedor='', dEta='', dUnidades=''

      for (const f of files) {
        const buf = await f.arrayBuffer()
        const wb  = XLSX.read(buf,{type:'array'})

        for (const sheetName of wb.SheetNames) {
          if (isChinese(sheetName)) continue
          const onlyMeta = META_ONLY_SHEETS.includes(sheetName.toLowerCase().trim())
          const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:''})
          if (aoa.length < 2) continue

          // ── Escanear metadatos (primeras 40 filas) ──────────
          for (let i=0; i<Math.min(40,aoa.length); i++) {
            const row = aoa[i]
            for (let j=0; j<row.length; j++) {
              const cell = String(row[j]??'').trim()
              if (!cell) continue
              const cn = cell.toLowerCase().replace(/[\s:#\n]/g,'')
              const nv = [row[j+1],row[j+2],row[j+3],row[j+4]]
                .map(v=>String(v??'').trim()).filter(v=>v.length>1)[0] || ''

              // PI
              if (!dPI && (cn==='sr'||cn==='sr#')) {
                const v = nv.replace(/^PI#/i,'').trim()
                if (/[A-Z]{2,}.*\d{4,}/i.test(v)) dPI = v
              }
              if (!dPI && (cn==='pi'||cn==='pi#')) {
                const v = nv.replace(/^PI#/i,'').trim()
                if (/[A-Z]{2,}.*\d{4,}/i.test(v)) dPI = v
              }
              if (!dPI && cn.includes('invoiceno')) {
                const v = nv.replace(/\s+/g,'')
                if (/[A-Z]{2,}[-]?\d{4,}/i.test(v)) dPI = v
              }

              // Modelo (debe contener letras, no solo números)
              if (!dModelo) {
                if (cn==='model'||cn==='modelo'||cn.includes('modelno')) {
                  const c = nv.replace(/\(.*\)/g,'').trim().toUpperCase()
                  if (c.length>1 && c.length<50 && !isChinese(nv) && /[A-Z]/.test(c)) dModelo = c
                }
                if (!dModelo && !isChinese(cell)) {
                  const mm = cell.match(/\b(SI\d{2,3}URF?|SI\d{2,3}UR)\b/i)
                  if (mm) dModelo = mm[0].toUpperCase()
                }
                if (!dModelo) {
                  const mm = cell.match(/MODEL\s*NO\.?\s*[:\s]+([A-Z][A-Z0-9]+UR[F]?)/i)
                  if (mm && !isChinese(mm[1])) dModelo = mm[1].toUpperCase()
                }
              }

              // Unidades
              if (!dUnidades) {
                if (cn.includes('totalqty')||cn.includes('totalsets')) {
                  const n = Number(nv.replace(/,/g,'')); if (n>100) dUnidades=String(n)
                }
                const qm = cell.match(/(\d[\d,]+)\s*(EA|SETS|PCS|UNITS)\b/i)
                if (qm) { const n=Number(qm[1].replace(/,/g,'')); if (n>100&&n<100000) dUnidades=String(n) }
              }

              // Proveedor
              if (!dProveedor && i<8) {
                const kw = ['co.,ltd','co., ltd','technology','electronics','trading','corp','limited','shenzhen','overseas','global']
                if (kw.some(k=>cell.toLowerCase().includes(k)) && cell.length>8 && cell.length<100)
                  dProveedor = cell.split('\n')[0].trim()
              }

              // ETA
              if (!dEta && (cn.includes('eta')||cn.includes('etd')||cn==='date'||cn==='date:')) {
                const p = parseDate(nv); if (p) dEta = p
              }
            }
          }

          if (onlyMeta) continue

          // ── Detectar fila de encabezado ──────────────────────
          let headerIdx=0, bestScore=-1
          for (let i=0; i<Math.min(40,aoa.length); i++) {
            const txt   = aoa[i].map((c:any)=>String(c).toLowerCase()).join(' ')
            const score = KEYWORDS.filter(k=>txt.includes(k)).length*3
                        + aoa[i].filter((c:any)=>String(c).trim()!=='').length
            if (score>bestScore) { bestScore=score; headerIdx=i }
          }

          const headers = aoa[headerIdx].map((h:any)=>String(h??'').trim().replace(/\n/g,' '))
          const fieldIdx = buildFieldIdx(headers)

          const get = (row:any[], f:string) =>
            fieldIdx[f]>=0 ? String(row[fieldIdx[f]]??'').trim() : ''

          const dataRows = aoa.slice(headerIdx+1)
            .filter(row=>row.some((c:any)=>String(c).trim()!==''))

          // PI desde columna (formato MTC)
          if (!dPI && fieldIdx['piCol']>=0) {
            for (const row of dataRows) {
              const v = String(row[fieldIdx['piCol']]??'').trim().replace(/^PI#/i,'')
              if (/[A-Z]{2,}.*\d{4,}/i.test(v)) { dPI=v; break }
            }
          }

          // ── FORMATO A: columna de contenedor (TCL, HKC) ──────
          if (fieldIdx['containerCol']>=0) {
            // Agrupar filas por contenedor → por partNo
            const byContainer: Record<string, Record<string,any>> = {}

            for (const row of dataRows) {
              const contVal = String(row[fieldIdx['containerCol']]??'').trim()
              if (!contVal) continue
              const cvL = contVal.toLowerCase()
              if (cvL.includes('total')||cvL.includes('container')||cvL.includes('contianer')) continue

              const pn  = get(row,'partNo')
              const ds  = get(row,'desc')
              const qty = Math.round(Number(get(row,'qty').replace(/,/g,''))||0)
              if ((!pn && !ds) || qty===0) continue
              if (SKIP_WORDS.some(w=>(pn+ds).toLowerCase().includes(w))) continue

              const unitPrice  = parseFloat(get(row,'value').replace(/[$,]/g,''))||0
              const rowTotal   = unitPrice * qty   // calcular por fila antes del merge

              if (!byContainer[contVal]) byContainer[contVal] = {}
              const key = pn || ds

              if (byContainer[contVal][key]) {
                // Acumular en el merge
                byContainer[contVal][key].qty         += qty
                byContainer[contVal][key].qtyBox      += Math.round(Number(get(row,'qtyBox').replace(/,/g,''))||0)
                byContainer[contVal][key].netWeight   += parseFloat(get(row,'netWeight').replace(/,/g,''))||0
                byContainer[contVal][key].grsWeight   += parseFloat(get(row,'grsWeight').replace(/,/g,''))||0
                byContainer[contVal][key].totalAmount += rowTotal
                byContainer[contVal][key].cbm         += parseFloat(get(row,'cbm').replace(/,/g,''))||0
              } else {
                byContainer[contVal][key] = {
                  partNo:      pn,
                  desc:        ds,
                  descCN:      get(row,'descCN'),
                  qty,
                  um:          get(row,'um')||'PCS',
                  cartonRef:   get(row,'cartonRef'),
                  qtyBox:      Math.round(Number(get(row,'qtyBox').replace(/,/g,''))||0),
                  qtyPerBox:   Math.round(Number(get(row,'qtyPerBox').replace(/,/g,''))||0),
                  netWeight:   parseFloat(get(row,'netWeight').replace(/,/g,''))||0,
                  grsWeight:   parseFloat(get(row,'grsWeight').replace(/,/g,''))||0,
                  value:       unitPrice,
                  totalAmount: rowTotal,
                  cbm:         parseFloat(get(row,'cbm').replace(/,/g,''))||0,
                  country:     get(row,'country')||'CHINA',
                }
              }
            }

            for (const [cont, partsMap] of Object.entries(byContainer)) {
              const items = Object.values(partsMap)
              if (items.length===0) continue
              const m = cont.match(/([A-Z]{2,6}\d{5,})/i)
              allSheets.push({
                sheetName: cont,
                contenedor: m ? m[1].toUpperCase() : cont.toUpperCase(),
                comentario: null,
                items,
              })
            }

          } else {
            // ── FORMATO B: cada hoja = un contenedor (Changhong, MTC, KTC) ──
            const items = dataRows.map((row:any[])=>{
              const pn        = get(row,'partNo')
              const ds        = get(row,'desc')
              const qty       = Math.round(Number(get(row,'qty').replace(/,/g,''))||0)
              const cartonVal = get(row,'cartonRef')
              if (isSkipRow(pn,ds,cartonVal)) return null
              const unitPrice = parseFloat(get(row,'value').replace(/[$,]/g,''))||0
              const totalRaw  = parseFloat(get(row,'totalAmount').replace(/[$,]/g,''))||0
              return {
                partNo:      pn,
                desc:        ds,
                descCN:      get(row,'descCN'),
                qty,
                um:          get(row,'um')||'PCS',
                cartonRef:   cartonVal,
                qtyBox:      Math.round(Number(get(row,'qtyBox').replace(/,/g,''))||0),
                qtyPerBox:   Math.round(Number(get(row,'qtyPerBox').replace(/,/g,''))||0),
                netWeight:   parseFloat(get(row,'netWeight').replace(/,/g,''))||0,
                grsWeight:   parseFloat(get(row,'grsWeight').replace(/,/g,''))||0,
                value:       unitPrice,
                totalAmount: totalRaw || (unitPrice * qty),
                cbm:         parseFloat(get(row,'cbm').replace(/,/g,''))||0,
                country:     get(row,'country')||'CHINA',
              }
            }).filter(Boolean)

            if (items.length>0) {
              const {contenedor:cont,comentario} = parseSheetName(sheetName)
              allSheets.push({sheetName,contenedor:cont,comentario,items})
            }
          }
        }
      }

      if (dPI)        setPiNum(dPI)
      if (dModelo)    setModelo(dModelo)
      if (dProveedor) setProveedor(dProveedor)
      if (dEta)       setEta(dEta)
      if (dUnidades)  setUnidades(dUnidades)
      if (allSheets[0]?.contenedor) setContenedor(allSheets[0].contenedor)
      setPreview(allSheets)

      const totalPartes = allSheets.reduce((a:number,s:any)=>a+s.items.length,0)
      alert(`✓ ${files.length} archivo(s) · ${allSheets.length} contenedor(es) · ${totalPartes} partes\nPI: ${dPI||'—'} · Modelo: ${dModelo||'—'}`)

    } catch(err:any) { alert('Error al leer: '+err.message) }
    setLoading(false)
    if (e.target) e.target.value=''
  }

  const submitPI = async () => {
    if (!piNum.trim())   { alert('El PI Number es obligatorio'); return }
    if (!preview.length) { alert('Carga el Packing List primero'); return }

    let modeloFinal = modelo.trim()
    if (!modeloFinal) {
      const m = window.prompt('No se detectó el Modelo.\n\nEscríbelo manualmente (ej: SI60URF):')
      if (!m||!m.trim()) { alert('El Modelo es obligatorio'); return }
      modeloFinal = m.trim().toUpperCase()
      setModelo(modeloFinal)
    }

    setLoading(true)
    try {
      let proveedorId: string|null = null
      if (proveedor.trim()) {
        const {data:ex} = await supabase.from('proveedores').select('id').ilike('nombre',proveedor.trim()).limit(1)
        if (ex?.length) {
          proveedorId = ex[0].id
        } else {
          const {data:nv,error:pvErr} = await supabase.from('proveedores')
            .insert({nombre:proveedor.trim(),codigo:proveedor.trim().slice(0,6).toUpperCase()}).select()
          if (pvErr) throw pvErr
          proveedorId = nv?.[0]?.id ?? null
        }
      }

      const etaValida = eta && eta.length===10 ? eta : null
      let totalPIs=0, totalItems=0

      for (const sheet of preview) {
        const {data:piData,error:piErr} = await supabase.from('pis').insert({
          pi_number:    `${piNum.trim()}-${sheet.contenedor}`,
          proveedor_id: proveedorId,
          modelo:       modeloFinal,
          contenedor:   sheet.contenedor,
          comentario:   sheet.comentario||null,
          eta:          etaValida,
          unidades_tv:  Math.round(Number(unidades)||0),
          notas:        notas.trim()||null,
          tipo:         'pi',
          status:       'pendiente',
        }).select()
        if (piErr) throw new Error(`Error PI ${sheet.contenedor}: ${piErr.message}`)

        const piId = piData![0].id
        const items = sheet.items.map((p:any)=>({
          pi_id:             piId,
          part_no:           p.partNo||'',
          descripcion:       p.desc||'',
          descripcion_cn:    p.descCN||null,
          qty_esperada:      Math.round(Number(p.qty)||0),
          um:                p.um||'PCS',
          carton:            p.cartonRef||null,
          carton_ref:        p.cartonRef||null,
          qty_box:           Math.round(Number(p.qtyBox)||0),
          qty_per_box:       Math.round(Number(p.qtyPerBox)||0),
          peso_neto:         Number(p.netWeight)||0,
          peso_bruto:        Number(p.grsWeight)||0,
          valor_unitario:    Number(p.value)||0,
          total_amount:      Number(p.totalAmount)||0,
          cbm:               Number(p.cbm)||0,
          country_of_origin: p.country||null,
        }))

        const {error:iErr} = await supabase.from('packing_list_items').insert(items)
        if (iErr) throw new Error(`Error partes ${sheet.contenedor}: ${iErr.message}`)

        await supabase.from('historial').insert({
          entidad:'pi', entidad_id:piId,
          accion:`PI registrado — ${sheet.contenedor} — ${sheet.items.length} partes`,
          usuario_nombre:'CE', rol:'CE',
        })
        totalPIs++; totalItems+=sheet.items.length
      }

      setPiNum(''); setModelo(''); setProveedor(''); setContenedor('')
      setEta(''); setUnidades(''); setNotas(''); setPreview([])
      await loadPIs(); setTab('pis')
      alert(`✓ ${totalPIs} PI(s) registradas con ${totalItems.toLocaleString()} partes.`)

    } catch(err:any) {
      alert('Error al guardar:\n'+err.message+'\n\nNo se guardó nada.')
    }
    setLoading(false)
  }

  const limpiar = () => {
    setPreview([]); setPiNum(''); setModelo(''); setProveedor('')
    setContenedor(''); setEta(''); setUnidades(''); setNotas('')
  }

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:960,margin:'0 auto',paddingBottom:40}}>
      <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:ROLE_COLOR.CE}}/>
        <span style={{fontSize:14,fontWeight:600,color:'#1a1a1a'}}>CEDIS Tijuana</span>
        <span style={{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:500,background:ROLE_BG.CE,color:ROLE_TEXT.CE}}>Comercio Exterior</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {onBack&&<button onClick={onBack} style={{padding:'5px 12px',borderRadius:8,border:'1px solid #ddd',background:'#f0f0f0',color:'#444',fontSize:12,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>← Inicio</button>}
          <Badge color="blue">PIs: {pis.length}</Badge>
          {userName&&<UserMenu email={userName} rol={userRol||'CE'} onLogout={onLogout||onBack}/>}
        </div>
      </div>
      <div style={{padding:'16px 20px 0'}}>
        <div style={{display:'flex',gap:2,borderBottom:'1px solid #eee',marginBottom:16}}>
          {[{k:'pis',l:`PIs (${pis.length})`},{k:'nuevo',l:'+ Nuevo PI'}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{padding:'7px 14px',border:'none',background:tab===t.k?ROLE_BG.CE:'transparent',
                color:tab===t.k?ROLE_TEXT.CE:'#888',borderRadius:'8px 8px 0 0',cursor:'pointer',fontSize:13,fontWeight:tab===t.k?600:400}}>{t.l}</button>
          ))}
        </div>

        {tab==='pis'&&<PIsAgrupados pis={pis} onGoToFaltantes={onGoToFaltantes}/>}

        {tab==='nuevo'&&(
          <div style={{maxWidth:640}}>
            <div style={{background:'#E6F1FB',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#0C447C'}}>
              Soporta: KTC · Changhong · MTC · TCL · HKC — Puedes cargar varios archivos del mismo PI a la vez.
            </div>
            <div style={{marginBottom:20,padding:14,border:'2px dashed #B5D4F4',borderRadius:10,textAlign:'center'}}>
              <div style={{fontSize:13,color:'#666',marginBottom:10}}>Sube uno o varios Packing Lists y los campos se llenarán solos</div>
              <Btn onClick={()=>fileRef.current?.click()} disabled={loading} style={{background:ROLE_COLOR.CE,color:'#fff'}}>
                {loading?'Leyendo...':'Cargar Excel (.xlsx / .xls)'}
              </Btn>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:'none'}} onChange={handleFile}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
              <Input label="PI Number"      value={piNum}      onChange={setPiNum}      placeholder="Auto-detectado" required/>
              <Input label="Modelo de TV"   value={modelo}     onChange={setModelo}     placeholder="Auto-detectado o se pedirá" required/>
              <Input label="Proveedor"      value={proveedor}  onChange={setProveedor}  placeholder="Auto-detectado"/>
              <Input label="No. Contenedor" value={contenedor} onChange={setContenedor} placeholder="Auto-detectado"/>
              <Input label="Unidades TV"    type="number" value={unidades} onChange={setUnidades} placeholder="5000"/>
              <Input label="ETA"            type="date"   value={eta}     onChange={setEta}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,color:'#666',fontWeight:500}}>Notas</label>
              <textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={2} placeholder="Observaciones..."
                style={{width:'100%',boxSizing:'border-box',marginTop:4,padding:'8px 10px',borderRadius:8,
                  border:'1px solid #ddd',fontSize:13,resize:'vertical',color:'#1a1a1a'}}/>
            </div>
            {preview.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:'#666',marginBottom:8,fontWeight:500}}>
                  {preview.length} contenedor(es) — {preview.reduce((a:number,s:any)=>a+s.items.length,0).toLocaleString()} partes únicas
                </div>
                {preview.map((sheet:any,si:number)=>(
                  <div key={si} style={{marginBottom:10,border:'1px solid #eee',borderRadius:8,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#f9f9f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <Badge color="blue">{sheet.contenedor}</Badge>
                        {sheet.comentario&&<Badge color="amber">{sheet.comentario}</Badge>}
                        <span style={{fontSize:12,color:'#888'}}>{sheet.items.length} partes</span>
                      </div>
                      <div style={{display:'flex',gap:12,fontSize:12}}>
                        <span style={{color:'#888'}}>{sheet.items.reduce((a:number,i:any)=>a+(i.qty||0),0).toLocaleString()} pzas</span>
                        <span style={{color:'#3B6D11',fontWeight:500}}>${sheet.items.reduce((a:number,i:any)=>a+(i.totalAmount||0),0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                      </div>
                    </div>
                    <Table cols={[
                      {key:'partNo',     label:'Part No'},
                      {key:'desc',       label:'Descripción',render:(v:string)=><span style={{maxWidth:200,display:'inline-block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span>},
                      {key:'qty',        label:'Piezas',    render:(v:number)=><Badge color="blue">{(v||0).toLocaleString()}</Badge>},
                      {key:'value',      label:'Unit Price', render:(v:number)=>v?`$${v.toFixed(4)}`:'—'},
                      {key:'totalAmount',label:'Total',      render:(v:number)=>v?<span style={{color:'#3B6D11'}}>${v.toFixed(2)}</span>:'—'},
                      {key:'um',         label:'UM'},
                      {key:'country',    label:'Origen'},
                    ]} rows={sheet.items}/>
                  </div>
                ))}
              </div>
            )}
            {preview.length>0&&(
              <div style={{display:'flex',gap:10}}>
                <Btn onClick={submitPI} disabled={loading} style={{background:ROLE_COLOR.CE,color:'#fff'}}>
                  {loading?'Guardando...':'Registrar PI'}
                </Btn>
                <Btn variant="secondary" onClick={limpiar}>Limpiar</Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── INVENTARIO AGRUPADO ───────────────────────────────────────
function InventarioAgrupado({ inventario }: { inventario: any[] }) {
  const [openPIs,   setOpenPIs]   = useState<Record<string,boolean>>({})
  const [openConts, setOpenConts] = useState<Record<string,boolean>>({})

  const grouped: Record<string,{modelo:string,contenedor:Record<string,any[]>}> = {}
  for (const item of inventario) {
    const parts  = item.pi_number?.split('-')||[]
    const cont   = parts[parts.length-1]||'SIN'
    const piBase = parts.slice(0,-1).join('-')||item.pi_number
    if (!grouped[piBase]) grouped[piBase]={modelo:item.modelo,contenedor:{}}
    if (!grouped[piBase].contenedor[cont]) grouped[piBase].contenedor[cont]=[]
    grouped[piBase].contenedor[cont].push(item)
  }
  const totalPzas = inventario.reduce((a,i)=>a+i.qty_disponible,0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <span style={{fontSize:13,color:'#888'}}>{inventario.length} partes</span>
        <div style={{padding:'6px 12px',background:'#EAF3DE',borderRadius:8,fontSize:13,color:'#3B6D11',fontWeight:500}}>
          Total: {totalPzas.toLocaleString()} pzas
        </div>
      </div>
      {Object.keys(grouped).length===0&&<div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>Inventario vacío.</div>}
      {Object.entries(grouped).map(([piBase,piData])=>{
        const isOpen  = openPIs[piBase]
        const piTotal = Object.values(piData.contenedor).flat().reduce((a,i)=>a+i.qty_disponible,0)
        const piComp  = Object.values(piData.contenedor).flat().reduce((a,i)=>a+(i.qty_comprometido||0),0)
        return (
          <div key={piBase} style={{marginBottom:8,border:'1px solid #eee',borderRadius:10,overflow:'hidden'}}>
            <div onClick={()=>setOpenPIs(s=>({...s,[piBase]:!s[piBase]}))}
              style={{padding:'10px 14px',background:'#f9f9f9',cursor:'pointer',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
              onMouseLeave={e=>e.currentTarget.style.background='#f9f9f9'}>
              <span style={{fontSize:14,color:'#888',minWidth:14}}>{isOpen?'▼':'▶'}</span>
              <Badge color="blue">{piBase}</Badge>
              <Badge color="purple">{piData.modelo}</Badge>
              <span style={{fontSize:12,color:'#888'}}>{Object.keys(piData.contenedor).length} contenedor(es)</span>
              <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
                {piComp>0&&<span style={{fontSize:12,color:'#854F0B'}}>Comp: {piComp.toLocaleString()}</span>}
                <span style={{fontSize:13,fontWeight:600,color:'#3B6D11'}}>{piTotal.toLocaleString()} disp.</span>
              </div>
            </div>
            {isOpen&&Object.entries(piData.contenedor).map(([cont,items])=>{
              const ck         = `${piBase}-${cont}`
              const isContOpen = openConts[ck]
              const cTotal     = items.reduce((a,i)=>a+i.qty_disponible,0)
              const cComp      = items.reduce((a,i)=>a+(i.qty_comprometido||0),0)
              return (
                <div key={cont} style={{borderTop:'1px solid #eee'}}>
                  <div onClick={()=>setOpenConts(s=>({...s,[ck]:!s[ck]}))}
                    style={{padding:'8px 14px 8px 32px',cursor:'pointer',display:'flex',gap:10,alignItems:'center',background:'#fafafa'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f5f5f5'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fafafa'}>
                    <span style={{fontSize:12,color:'#aaa',minWidth:14}}>{isContOpen?'▼':'▶'}</span>
                    <Badge color="teal">{cont}</Badge>
                    <span style={{fontSize:12,color:'#888'}}>{items.length} partes</span>
                    <div style={{marginLeft:'auto',display:'flex',gap:10}}>
                      {cComp>0&&<span style={{fontSize:12,color:'#854F0B'}}>{cComp.toLocaleString()} comp.</span>}
                      <span style={{fontSize:12,fontWeight:500,color:'#3B6D11'}}>{cTotal.toLocaleString()} disp.</span>
                    </div>
                  </div>
                  {isContOpen&&(
                    <div style={{borderTop:'1px solid #f0f0f0'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                        <thead><tr style={{background:'#f9f9f9',borderBottom:'1px solid #eee'}}>
                          {['Part No','Descripción','Disponible','Comprometido','UM'].map(h=>(
                            <th key={h} style={{padding:'6px 10px',textAlign:'left',color:'#aaa',fontWeight:500}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {items.map((item:any,i:number)=>(
                            <tr key={i} style={{borderBottom:'1px solid #f5f5f5'}}>
                              <td style={{padding:'6px 10px',fontFamily:'monospace',fontSize:11,color:'#555'}}>{item.part_no}</td>
                              <td style={{padding:'6px 10px'}}><span style={{display:'block',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#444'}}>{item.descripcion}</span></td>
                              <td style={{padding:'6px 10px'}}><Badge color={item.qty_disponible<=0?'red':item.qty_disponible<20?'amber':'green'}>{(item.qty_disponible||0).toLocaleString()}</Badge></td>
                              <td style={{padding:'6px 10px'}}>{(item.qty_comprometido||0)>0?<Badge color="amber">{item.qty_comprometido.toLocaleString()}</Badge>:<span style={{color:'#ccc'}}>—</span>}</td>
                              <td style={{padding:'6px 10px',color:'#888'}}>{item.um}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── SOLICITUDES ALM (agrupado PI → Contenedor → Partes) ───────
function SolicitudesALM({ solicitudes, loading, onEntregar }: {
  solicitudes: any[], loading: boolean, onEntregar: (sol:any)=>void
}) {
  const [openSols, setOpenSols] = useState<Record<string,boolean>>({})
  const [openPIs,  setOpenPIs]  = useState<Record<string,boolean>>({})

  if (solicitudes.length===0) return (
    <div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>No hay solicitudes pendientes.</div>
  )

  return (
    <div>
      {solicitudes.map((sol:any)=>{
        const total = (sol.solicitud_items||[]).reduce((a:number,i:any)=>a+i.qty,0)
        const isOpen = openSols[sol.id]

        // Agrupar items por PI base → contenedor
        const byPI: Record<string,Record<string,any[]>> = {}
        for (const item of sol.solicitud_items||[]) {
          const parts   = item.pi_number?.split('-')||[]
          const piBase  = parts.slice(0,-1).join('-')||item.pi_number
          const cont    = parts[parts.length-1]||'—'
          if (!byPI[piBase]) byPI[piBase]={}
          if (!byPI[piBase][cont]) byPI[piBase][cont]=[]
          byPI[piBase][cont].push(item)
        }

        return (
          <div key={sol.id} style={{border:'0.5px solid #e0e0e0',borderRadius:10,marginBottom:10,overflow:'hidden'}}>
            {/* Header solicitud */}
            <div style={{padding:'12px 16px',background:'#f9f9f9',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',cursor:'pointer'}}
              onClick={()=>setOpenSols(s=>({...s,[sol.id]:!s[sol.id]}))}>
              <span style={{fontSize:11,color:'#aaa',minWidth:14}}>{isOpen?'▼':'▶'}</span>
              <Badge color="purple">{sol.id?.slice(0,8).toUpperCase()}</Badge>
              <Badge color="amber">Solicitado</Badge>
              <span style={{fontSize:13,fontWeight:600,color:'#1a1a1a'}}>{sol.area}</span>
              <span style={{fontSize:12,color:'#888'}}>{(sol.solicitud_items||[]).length} partes · {total.toLocaleString()} pzas</span>
              {sol.notas&&<span style={{fontSize:12,color:'#888',fontStyle:'italic'}}>· {sol.notas}</span>}
              <span style={{fontSize:12,color:'#888',marginLeft:'auto'}}>{new Date(sol.created_at).toLocaleString('es-MX')}</span>
            </div>

            {/* Detalle expandido: PI → Contenedor → Partes */}
            {isOpen&&(
              <div style={{borderTop:'0.5px solid #eee'}}>
                {Object.entries(byPI).map(([piBase, contMap])=>{
                  const piKey   = `${sol.id}-${piBase}`
                  const isPIOpen = openPIs[piKey]
                  const piTotal  = Object.values(contMap).flat().reduce((a:number,i:any)=>a+i.qty,0)

                  return (
                    <div key={piBase} style={{borderBottom:'0.5px solid #f0f0f0'}}>
                      {/* Fila PI */}
                      <div onClick={()=>setOpenPIs(s=>({...s,[piKey]:!s[piKey]}))}
                        style={{padding:'8px 16px 8px 36px',display:'flex',gap:10,alignItems:'center',
                          cursor:'pointer',background:'#fafafa',flexWrap:'wrap'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#f5f5f5'}
                        onMouseLeave={e=>e.currentTarget.style.background='#fafafa'}>
                        <span style={{fontSize:11,color:'#aaa',minWidth:14}}>{isPIOpen?'▼':'▶'}</span>
                        <Badge color="blue">{piBase}</Badge>
                        <span style={{fontSize:12,color:'#888'}}>{Object.keys(contMap).length} contenedor{Object.keys(contMap).length!==1?'es':''}</span>
                        <span style={{fontSize:12,color:'#888',marginLeft:'auto'}}>{piTotal.toLocaleString()} pzas</span>
                      </div>

                      {/* Contenedores */}
                      {isPIOpen&&Object.entries(contMap).map(([cont, items])=>(
                        <div key={cont} style={{borderTop:'0.5px solid #f0f0f0'}}>
                          {/* Fila Contenedor */}
                          <div style={{padding:'6px 16px 6px 60px',display:'flex',gap:10,
                            alignItems:'center',background:'#fdfdfd',flexWrap:'wrap'}}>
                            <Badge color="teal">{cont}</Badge>
                            <span style={{fontSize:12,color:'#888'}}>{items.length} parte{items.length!==1?'s':''}</span>
                            <span style={{fontSize:12,color:'#888',marginLeft:'auto'}}>
                              {items.reduce((a:number,i:any)=>a+i.qty,0).toLocaleString()} pzas
                            </span>
                          </div>
                          {/* Tabla partes */}
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                            <thead><tr style={{background:'#f9f9f9',borderBottom:'0.5px solid #eee'}}>
                              {['Part No','Descripción','Cantidad','UM'].map(h=>(
                                <th key={h} style={{padding:'5px 16px 5px 76px',textAlign:'left',
                                  color:'#aaa',fontWeight:500,whiteSpace:'nowrap',
                                  paddingLeft:h==='Part No'?76:12}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {items.map((item:any,i:number)=>(
                                <tr key={i} style={{borderBottom:'0.5px solid #f5f5f5'}}>
                                  <td style={{padding:'7px 12px 7px 76px',fontFamily:'monospace',fontSize:11,color:'#555'}}>{item.part_no}</td>
                                  <td style={{padding:'7px 12px'}}><span style={{display:'block',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.descripcion}</span></td>
                                  <td style={{padding:'7px 12px',fontWeight:500}}>{item.qty?.toLocaleString()}</td>
                                  <td style={{padding:'7px 12px',color:'#888'}}>{item.um}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Botón entregar */}
                <div style={{padding:'12px 16px',borderTop:'0.5px solid #eee',display:'flex',justifyContent:'flex-end'}}>
                  <Btn onClick={()=>onEntregar(sol)} disabled={loading}
                    style={{background:ROLE_COLOR.ALM,color:'#fff'}}>
                    Marcar como entregado
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── ALMACÉN ───────────────────────────────────────────────────
function ALMView({ onBack, onLogout, initialTab, userName, userRol }: { onBack: ()=>void, onLogout?: ()=>void, initialTab?: string, userName?: string, userRol?: string }) {
  const [tab, setTab]               = useState(initialTab||'pendientes')
  const [pendientes, setPendientes] = useState<any[]>([])
  const [recibidos,  setRecibidos]  = useState<any[]>([])
  const [inventario, setInventario] = useState<any[]>([])
  const [solicitudes,setSolicitudes]= useState<any[]>([])
  const [discrepancias,setDiscrepancias] = useState<any[]>([])
  const [receiving,  setReceiving]  = useState<any>(null)
  const [recItems,   setRecItems]   = useState<any[]>([])
  const [loading,    setLoading]    = useState(false)
  const [busqueda,   setBusqueda]   = useState('')
  const [filtroPI,   setFiltroPI]   = useState('')

  useEffect(()=>{ loadData() },[])

  const loadData = async () => {
    const [{data:pend},{data:rec},{data:inv},{data:sol},{data:disc}] = await Promise.all([
      supabase.from('pis').select('*, packing_list_items(*)').eq('tipo','pi').eq('status','pendiente').order('created_at',{ascending:false}),
      supabase.from('pis').select('*').eq('tipo','pi').in('status',['recibido','con_faltantes']).order('created_at',{ascending:false}),
      supabase.from('inventario').select('*').order('modelo'),
      supabase.from('solicitudes').select('*, solicitud_items(*)').eq('status','solicitado').order('created_at',{ascending:false}),
      supabase.from('discrepancias').select('*').order('created_at',{ascending:false}),
    ])
    setPendientes(pend||[]); setRecibidos(rec||[]); setInventario(inv||[]); setSolicitudes(sol||[]); setDiscrepancias(disc||[])
  }

  const openReceiving = (pi:any) => {
    setReceiving(pi)
    setRecItems((pi.packing_list_items||[]).map((item:any)=>({...item,rec_qty:item.qty_esperada,tiene_faltante:false,nota_faltante:''})))
    setTab('recibir')
  }

  const confirmReceiving = async () => {
    if (!receiving) return
    setLoading(true)
    try {
      const hasFaltante = recItems.some(i=>i.tiene_faltante&&(i.qty_esperada-Number(i.rec_qty))>0)
      for (const item of recItems) {
        const qty = Number(item.rec_qty)||0; if (qty<=0) continue
        const {data:ex} = await supabase.from('inventario').select('id,qty_disponible').eq('pi_id',receiving.id).eq('part_no',item.part_no).limit(1)
        if (ex?.length) await supabase.from('inventario').update({qty_disponible:ex[0].qty_disponible+qty}).eq('id',ex[0].id)
        else await supabase.from('inventario').insert({pi_id:receiving.id,pi_number:receiving.pi_number,proveedor_id:receiving.proveedor_id,modelo:receiving.modelo,part_no:item.part_no,descripcion:item.descripcion,um:item.um,qty_disponible:qty,qty_comprometido:0})
      }
      const faltantes = recItems.filter(i=>i.tiene_faltante&&(i.qty_esperada-Number(i.rec_qty))>0)
      for (const f of faltantes)
        await supabase.from('discrepancias').insert({tipo:'recepcion',pi_id:receiving.id,pi_number:receiving.pi_number,modelo:receiving.modelo,part_no:f.part_no,descripcion:f.descripcion,qty_declarada:f.qty_esperada,qty_real:Number(f.rec_qty),vence_at:new Date(Date.now()+48*60*60*1000).toISOString(),status:'abierto'})
      await supabase.from('pis').update({status:hasFaltante?'con_faltantes':'recibido'}).eq('id',receiving.id)
      await supabase.from('historial').insert({entidad:'pi',entidad_id:receiving.id,accion:hasFaltante?`Recibido con ${faltantes.length} faltante(s)`:'Recibido al 100%',usuario_nombre:'Almacén',rol:'ALM'})
      await loadData(); setReceiving(null); setRecItems([]); setTab('pendientes')
      alert(hasFaltante?`Recibido con ${faltantes.length} faltante(s).`:'✓ Recibido al 100%.')
    } catch(err:any) { alert('Error: '+err.message) }
    setLoading(false)
  }

  const entregarSolicitud = async (sol:any) => {
    setLoading(true)
    try {
      for (const item of sol.solicitud_items||[]) {
        const {data:inv} = await supabase.from('inventario').select('id,qty_disponible,qty_comprometido').eq('pi_number',item.pi_number).eq('part_no',item.part_no).limit(1)
        if (inv?.length) await supabase.from('inventario').update({qty_disponible:Math.max(0,inv[0].qty_disponible-item.qty),qty_comprometido:(inv[0].qty_comprometido||0)+item.qty}).eq('id',inv[0].id)
      }
      await supabase.from('solicitudes').update({status:'entregado_alm'}).eq('id',sol.id)
      await loadData(); alert('✓ Entregado. Stock movido a comprometido.')
    } catch(err:any) { alert('Error: '+err.message) }
    setLoading(false)
  }

  const TABS = [
    {k:'pendientes',  l:`Pendientes (${pendientes.length})`},
    {k:'faltantes',   l:`Faltantes (${discrepancias.filter(d=>d.status==='abierto').length})`},
    {k:'solicitudes', l:`Solicitudes (${solicitudes.length})`},
    {k:'recibidos',   l:`Recibidos (${recibidos.length})`},
    {k:'inventario',  l:'Inventario'},
  ]

  // PIs únicas para el filtro
  const pisBases = [...new Set(pendientes.map(p=>{
    const pts = p.pi_number?.split('-')||[]
    return pts.slice(0,-1).join('-')||p.pi_number
  }))].filter(Boolean)

  // Filtrar pendientes por búsqueda y PI
  const pendientesFiltrados = pendientes.filter(p=>{
    const q = busqueda.toLowerCase()
    const matchQ = !q || p.pi_number?.toLowerCase().includes(q) || p.contenedor?.toLowerCase().includes(q)
    const piBase = (p.pi_number?.split('-')||[]).slice(0,-1).join('-')||p.pi_number
    const matchPI = !filtroPI || piBase===filtroPI
    return matchQ && matchPI
  })

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:960,margin:'0 auto',paddingBottom:40}}>
      <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:ROLE_COLOR.ALM}}/>
        <span style={{fontSize:14,fontWeight:600}}>CEDIS Tijuana</span>
        <span style={{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:500,background:ROLE_BG.ALM,color:ROLE_TEXT.ALM}}>Almacén</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <Badge color="green">Stock: {inventario.reduce((a,i)=>a+i.qty_disponible,0).toLocaleString()}</Badge>
          <Badge color="amber">Pendientes: {pendientes.length}</Badge>
          {onBack&&<button onClick={onBack} style={{padding:'5px 12px',borderRadius:8,border:'1px solid #ddd',background:'#f0f0f0',color:'#444',fontSize:12,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>← Inicio</button>}
          {userName&&<UserMenu email={userName} rol={userRol||'ALM'} onLogout={onLogout||onBack}/>}
        </div>
      </div>
      <div style={{padding:'16px 20px 0'}}>
        {tab!=='recibir'&&(
          <div style={{display:'flex',gap:2,borderBottom:'1px solid #eee',marginBottom:16}}>
            {TABS.map(t=><button key={t.k} onClick={()=>setTab(t.k)}
              style={{padding:'7px 14px',border:'none',background:tab===t.k?ROLE_BG.ALM:'transparent',color:tab===t.k?ROLE_TEXT.ALM:'#888',borderRadius:'8px 8px 0 0',cursor:'pointer',fontSize:13,fontWeight:tab===t.k?600:400}}>{t.l}</button>)}
          </div>
        )}
        {tab==='pendientes'&&(
          <div>
            {/* Filtros */}
            <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
              <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
                placeholder="Buscar PI o contenedor..."
                style={{flex:1,minWidth:180,padding:'7px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13,outline:'none'}}/>
              <select value={filtroPI} onChange={e=>setFiltroPI(e.target.value)}
                style={{padding:'7px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background:'#fff',color:'#1a1a1a',cursor:'pointer'}}>
                <option value="">Todas las PIs</option>
                {pisBases.map((pi:string)=><option key={pi} value={pi}>{pi}</option>)}
              </select>
              {(busqueda||filtroPI)&&(
                <Btn small variant="secondary" onClick={()=>{setBusqueda('');setFiltroPI('')}}>Limpiar</Btn>
              )}
              <span style={{fontSize:12,color:'#888'}}>{pendientesFiltrados.length} de {pendientes.length}</span>
            </div>
            {pendientesFiltrados.length===0
              ?<div style={{padding:24,textAlign:'center',color:'#bbb'}}>
                {pendientes.length===0?'No hay contenedores pendientes.':'Sin resultados para esta búsqueda.'}
              </div>
              :pendientesFiltrados.map((pi:any)=>(
              <div key={pi.id} style={{border:'1px solid #eee',borderRadius:10,padding:14,marginBottom:10,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,flexWrap:'wrap'}}>
                    <Badge color="blue">{pi.pi_number}</Badge><Badge color="purple">{pi.modelo}</Badge>
                    {pi.comentario&&<Badge color="amber">{pi.comentario}</Badge>}
                  </div>
                  <div style={{fontSize:13,color:'#444',marginBottom:2}}>Contenedor: <strong>{pi.contenedor}</strong></div>
                  <div style={{fontSize:12,color:'#888'}}>{(pi.packing_list_items||[]).length} partes · {(pi.packing_list_items||[]).reduce((a:number,i:any)=>a+(i.qty_esperada||0),0).toLocaleString()} pzas{pi.eta&&` · ETA: ${pi.eta}`}</div>
                </div>
                <Btn onClick={()=>openReceiving(pi)} style={{background:ROLE_COLOR.ALM,color:'#fff'}}>Iniciar recepción</Btn>
              </div>
            ))}
          </div>
        )}
        {tab==='recibir'&&receiving&&(
          <div>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
              <Btn small variant="secondary" onClick={()=>{setTab('pendientes');setReceiving(null)}}>← Volver</Btn>
              <Badge color="blue">{receiving.pi_number}</Badge><Badge color="purple">{receiving.modelo}</Badge>
              <span style={{fontSize:13,fontWeight:600}}>{receiving.contenedor}</span>
              {receiving.comentario&&<Badge color="amber">{receiving.comentario}</Badge>}
            </div>
            <div style={{background:'#E1F5EE',borderRadius:8,padding:'8px 14px',marginBottom:14,fontSize:12,color:'#085041'}}>
              Captura la cantidad recibida. Si hay faltante, marca la casilla y ajusta el número.
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{borderBottom:'2px solid #eee',background:'#f9f9f9'}}>
                  {['Part No','Descripción','Esperado','Recibido','Faltante','¿Faltante?','Nota'].map(h=>(
                    <th key={h} style={{padding:'8px 10px',textAlign:'left',color:'#888',fontSize:12,fontWeight:500}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {recItems.map((item:any,i:number)=>{
                    const faltante    = item.qty_esperada-(Number(item.rec_qty)||0)
                    const hayFaltante = item.tiene_faltante&&faltante>0
                    return (
                      <tr key={i} style={{borderBottom:'1px solid #f5f5f5',background:hayFaltante?'#FFF8F0':'transparent'}}>
                        <td style={{padding:'8px 10px',fontFamily:'monospace',fontSize:11}}>{item.part_no}</td>
                        <td style={{padding:'8px 10px'}}><span style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180,fontSize:12}}>{item.descripcion}</span></td>
                        <td style={{padding:'8px 10px',fontWeight:500,textAlign:'right'}}>{(item.qty_esperada||0).toLocaleString()}</td>
                        <td style={{padding:'8px 10px',textAlign:'right'}}>
                          {item.tiene_faltante
                            ?<input type="number" min={0} max={item.qty_esperada} value={item.rec_qty}
                                onFocus={e=>e.target.select()} onKeyDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}
                                onChange={e=>{const v=Math.min(Math.max(0,Number(e.target.value)),item.qty_esperada);setRecItems(ri=>ri.map((x,j)=>j===i?{...x,rec_qty:v}:x))}}
                                style={{width:90,padding:'6px 8px',borderRadius:6,border:'2px solid #0F6E56',textAlign:'right',fontSize:14,fontWeight:500,background:'#fff',color:'#1a1a1a',outline:'none'}}/>
                            :<span style={{color:'#3B6D11',fontWeight:500}}>{(item.qty_esperada||0).toLocaleString()}</span>}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',color:hayFaltante?'#A32D2D':'#ccc',fontWeight:hayFaltante?600:400}}>{hayFaltante?faltante.toLocaleString():'—'}</td>
                        <td style={{padding:'8px 10px',textAlign:'center'}}>
                          <input type="checkbox" checked={item.tiene_faltante}
                            onChange={e=>setRecItems(ri=>ri.map((x,j)=>j===i?{...x,tiene_faltante:e.target.checked,rec_qty:x.qty_esperada}:x))}
                            style={{cursor:'pointer',width:16,height:16}}/>
                        </td>
                        <td style={{padding:'8px 10px'}}>
                          {item.tiene_faltante&&<input placeholder="Motivo..." value={item.nota_faltante}
                            onKeyDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}
                            onChange={e=>setRecItems(ri=>ri.map((x,j)=>j===i?{...x,nota_faltante:e.target.value}:x))}
                            style={{width:140,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}/>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{marginTop:12,padding:'10px 14px',background:'#f9f9f9',borderRadius:8,display:'flex',gap:20,flexWrap:'wrap',fontSize:13}}>
              <span>Esperado: <strong>{recItems.reduce((a,i)=>a+(i.qty_esperada||0),0).toLocaleString()}</strong></span>
              <span style={{color:'#3B6D11'}}>Recibido: <strong>{recItems.reduce((a,i)=>a+(Number(i.rec_qty)||0),0).toLocaleString()}</strong></span>
              {recItems.some(i=>i.tiene_faltante)&&<span style={{color:'#A32D2D'}}>Faltante: <strong>{recItems.filter(i=>i.tiene_faltante).reduce((a,i)=>a+(i.qty_esperada-Number(i.rec_qty)),0).toLocaleString()}</strong></span>}
            </div>
            <div style={{marginTop:14,display:'flex',gap:10}}>
              <Btn onClick={confirmReceiving} disabled={loading} style={{background:ROLE_COLOR.ALM,color:'#fff'}}>{loading?'Guardando...':'Confirmar recepción'}</Btn>
              <Btn variant="secondary" onClick={()=>{setTab('pendientes');setReceiving(null)}}>Cancelar</Btn>
            </div>
          </div>
        )}
        {tab==='faltantes'&&(
          <div>
            {/* Métricas faltantes */}
            {(()=>{
              const abiertos  = discrepancias.filter(d=>d.status==='abierto')
              const resueltos = discrepancias.filter(d=>d.status==='resuelto')
              const vencidos  = abiertos.filter(d=>new Date(d.vence_at).getTime()<Date.now())
              const piezasPend = abiertos.reduce((a,d)=>a+(d.qty_declarada-d.qty_real),0)
              return (
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
                  {[
                    {label:'Faltantes abiertos', val:String(abiertos.length),  color:'#A32D2D'},
                    {label:'Piezas pendientes',  val:piezasPend.toLocaleString(), color:'#1a1a1a'},
                    {label:'Vencidos (>48hrs)',  val:String(vencidos.length),  color:vencidos.length>0?'#854F0B':'#3B6D11'},
                    {label:'Resueltos',          val:String(resueltos.length), color:'#3B6D11'},
                  ].map(m=>(
                    <div key={m.label} style={{background:'#f9f9f9',borderRadius:8,padding:'10px 14px'}}>
                      <div style={{fontSize:11,color:'#888',marginBottom:2}}>{m.label}</div>
                      <div style={{fontSize:18,fontWeight:500,color:m.color}}>{m.val}</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Abiertos */}
            {(()=>{
              const abiertos = discrepancias.filter(d=>d.status==='abierto')
              if (abiertos.length===0) return <div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>No hay faltantes abiertos.</div>

              // Agrupar por pi_number
              const byPI: Record<string,any[]> = {}
              for (const d of abiertos) {
                if (!byPI[d.pi_number]) byPI[d.pi_number]=[]
                byPI[d.pi_number].push(d)
              }

              const resolverFaltante = async (id:string) => {
                await supabase.from('discrepancias').update({status:'resuelto'}).eq('id',id)
                await loadData()
              }

              return Object.entries(byPI).map(([piNum,items])=>{
                const vencidos = items.filter(d=>new Date(d.vence_at).getTime()<Date.now())
                return (
                  <div key={piNum} style={{border:'0.5px solid #e0e0e0',borderRadius:10,marginBottom:10,overflow:'hidden'}}>
                    <div style={{padding:'10px 16px',background:'#f9f9f9',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                      <Badge color="blue">{piNum?.split('-').slice(0,-1).join('-')}</Badge>
                      <Badge color="teal">{piNum?.split('-').pop()}</Badge>
                      <Badge color="coral">{items.length} faltante{items.length!==1?'s':''}</Badge>
                      {vencidos.length>0&&<Badge color="red">{vencidos.length} vencido{vencidos.length!==1?'s':''}</Badge>}
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead><tr style={{borderBottom:'0.5px solid #eee',background:'#fafafa'}}>
                        {['Part No','Descripción','Declarado','Recibido','Faltante','Plazo',''].map(h=>(
                          <th key={h} style={{padding:'6px 12px',textAlign:'left',color:'#aaa',fontWeight:500,whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {items.map((d:any)=>{
                          const horas = Math.max(0,Math.ceil((new Date(d.vence_at).getTime()-Date.now())/3600000))
                          const vencido = new Date(d.vence_at).getTime()<Date.now()
                          const timerBg = vencido?'#FCEBEB':horas<=12?'#FAEEDA':'#E6F1FB'
                          const timerTx = vencido?'#A32D2D':horas<=12?'#854F0B':'#0C447C'
                          return (
                            <tr key={d.id} style={{borderBottom:'0.5px solid #f5f5f5',background:vencido?'#FFFBF5':'transparent'}}>
                              <td style={{padding:'8px 12px',fontFamily:'monospace',fontSize:11}}>{d.part_no}</td>
                              <td style={{padding:'8px 12px'}}><span style={{display:'block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.descripcion}</span></td>
                              <td style={{padding:'8px 12px',textAlign:'right'}}>{(d.qty_declarada||0).toLocaleString()}</td>
                              <td style={{padding:'8px 12px',textAlign:'right'}}>{(d.qty_real||0).toLocaleString()}</td>
                              <td style={{padding:'8px 12px',textAlign:'right'}}><strong style={{color:'#A32D2D'}}>{(d.qty_declarada-d.qty_real).toLocaleString()}</strong></td>
                              <td style={{padding:'8px 12px'}}>
                                <span style={{padding:'2px 7px',borderRadius:8,fontSize:11,fontWeight:500,background:timerBg,color:timerTx}}>
                                  {vencido?'VENCIDO':`${horas}hrs`}
                                </span>
                              </td>
                              <td style={{padding:'8px 12px'}}>
                                <button onClick={()=>resolverFaltante(d.id)}
                                  style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:500,cursor:'pointer',background:'#E1F5EE',color:'#085041',border:'none'}}>
                                  Resolver
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })
            })()}

            {/* Resueltos */}
            {(()=>{
              const resueltos = discrepancias.filter(d=>d.status==='resuelto')
              if (resueltos.length===0) return null
              return (
                <div style={{marginTop:20}}>
                  <div style={{fontSize:12,color:'#888',fontWeight:500,marginBottom:8}}>Resueltos</div>
                  {resueltos.map((d:any)=>(
                    <div key={d.id} style={{display:'flex',gap:10,alignItems:'center',padding:'8px 14px',
                      border:'0.5px solid #eee',borderRadius:8,marginBottom:6,opacity:0.6,flexWrap:'wrap'}}>
                      <Badge color="blue">{d.pi_number?.split('-').slice(0,-1).join('-')}</Badge>
                      <Badge color="teal">{d.pi_number?.split('-').pop()}</Badge>
                      <span style={{fontSize:12,fontFamily:'monospace'}}>{d.part_no}</span>
                      <span style={{fontSize:12,color:'#888'}}>{d.descripcion?.slice(0,40)}</span>
                      <span style={{marginLeft:'auto'}}><Badge color="green">resuelto</Badge></span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab==='solicitudes'&&(
          <SolicitudesALM
            solicitudes={solicitudes}
            loading={loading}
            onEntregar={entregarSolicitud}
          />
        )}
        {tab==='recibidos'&&(
          <Table cols={[
            {key:'pi_number', label:'PI',        render:(v:string)=><Badge color="blue">{v}</Badge>},
            {key:'modelo',    label:'Modelo',     render:(v:string)=><Badge color="purple">{v}</Badge>},
            {key:'contenedor',label:'Contenedor'},
            {key:'comentario',label:'Comentario',render:(v:string)=>v?<Badge color="amber">{v}</Badge>:'—'},
            {key:'status',    label:'Estatus',   render:(v:string)=><Badge color={v==='recibido'?'green':'coral'}>{v}</Badge>},
          ]} rows={recibidos} emptyMsg="Sin contenedores recibidos."/>
        )}
        {tab==='inventario'&&<InventarioAgrupado inventario={inventario}/>}
      </div>
    </div>
  )
}

// ── PRODUCCIÓN ────────────────────────────────────────────────
function PRODView({ onBack, onLogout, userName, userRol }: { onBack: ()=>void, onLogout?: ()=>void, userName?: string, userRol?: string }) {
  const [tab,          setTab]          = useState('solicitar')
  const [modo,         setModo]         = useState<'pi'|'contenedor'|'parte'|'libre'>('pi')
  const [pis,          setPIs]          = useState<any[]>([])
  const [inventario,   setInventario]   = useState<any[]>([])
  const [solicitudes,  setSolicitudes]  = useState<any[]>([])
  const [discrepancias,setDiscrepancias]= useState<any[]>([])
  const [loading,      setLoading]      = useState(false)
  const [area,         setArea]         = useState('')
  const [notas,        setNotas]        = useState('')
  const [selectedPI,   setSelectedPI]   = useState('')
  const [selectedCont, setSelectedCont] = useState('')
  const [searchPart,   setSearchPart]   = useState('')
  const [selItems,     setSelItems]     = useState<Record<string,number>>({})
  const [expandedSols, setExpandedSols] = useState<Record<string,boolean>>({})

  useEffect(()=>{ loadData() },[])

  const loadData = async () => {
    const [{data:pisData},{data:invData},{data:solData},{data:discData}] = await Promise.all([
      supabase.from('pis').select('*').eq('tipo','pi').in('status',['recibido','con_faltantes']).order('created_at',{ascending:false}),
      supabase.from('inventario').select('*').gt('qty_disponible',0).order('modelo'),
      supabase.from('solicitudes').select('*, solicitud_items(*)').order('created_at',{ascending:false}),
      supabase.from('discrepancias').select('*').eq('status','abierto'),
    ])
    setPIs(pisData||[]); setInventario(invData||[]); setSolicitudes(solData||[]); setDiscrepancias(discData||[])
  }

  const uniquePIs    = [...new Set(pis.map(p=>{const pts=p.pi_number?.split('-')||[];return pts.slice(0,-1).join('-')}))].filter(Boolean)
  const contsByPI    = pis.filter(p=>p.pi_number?.startsWith(selectedPI+'-')).map(p=>({pi_number:p.pi_number,contenedor:p.contenedor,comentario:p.comentario}))

  const filteredItems = () => {
    let items=inventario
    if (modo==='pi'&&selectedPI)           items=items.filter(i=>i.pi_number?.startsWith(selectedPI+'-')||i.pi_number===selectedPI)
    if (modo==='contenedor'&&selectedCont) items=items.filter(i=>i.pi_number===selectedCont)
    if (modo==='parte'&&searchPart)        items=items.filter(i=>i.part_no?.toLowerCase().includes(searchPart.toLowerCase())||i.descripcion?.toLowerCase().includes(searchPart.toLowerCase()))
    return items
  }

  const totalSel = Object.values(selItems).reduce((a,v)=>a+v,0)
  const setQty   = (key:string,val:number,max:number)=>setSelItems(s=>({...s,[key]:Math.min(Math.max(1,val),max)}))

  const submitSolicitud = async () => {
    if (!area){alert('Indica tu área');return}
    const items=Object.entries(selItems).filter(([,q])=>q>0)
    if (!items.length){alert('Selecciona al menos una parte');return}
    setLoading(true)
    try {
      const {data:solData,error:solErr}=await supabase.from('solicitudes').insert({tipo:'materiales',area,notas:notas||null,modo_solicitud:modo,status:'solicitado'}).select()
      if (solErr) throw solErr
      const solId=solData![0].id
      const solItems=items.map(([key,qty])=>{
        const inv=inventario.find(i=>i.id===key)
        return {solicitud_id:solId,pi_id:inv?.pi_id,pi_number:inv?.pi_number,modelo:inv?.modelo,part_no:inv?.part_no,descripcion:inv?.descripcion,um:inv?.um,qty}
      })
      const {error:iErr}=await supabase.from('solicitud_items').insert(solItems)
      if (iErr) throw iErr
      setSelItems({}); setArea(''); setNotas(''); setSelectedPI(''); setSelectedCont('')
      await loadData(); setTab('missolicitudes')
      alert(`✓ Solicitud enviada — ${items.length} partes · ${totalSel.toLocaleString()} pzas`)
    } catch(err:any){alert('Error: '+err.message)}
    setLoading(false)
  }

  const confirmarRecepcion = async (sol:any) => {
    setLoading(true)
    try {
      for (const item of sol.solicitud_items||[]) {
        const {data:inv}=await supabase.from('inventario').select('id,qty_comprometido').eq('pi_number',item.pi_number).eq('part_no',item.part_no).limit(1)
        if (inv?.length) await supabase.from('inventario').update({qty_comprometido:Math.max(0,(inv[0].qty_comprometido||0)-item.qty)}).eq('id',inv[0].id)
      }
      await supabase.from('solicitudes').update({status:'recibido_prod'}).eq('id',sol.id)
      await loadData(); alert('✓ Recepción confirmada.')
    } catch(err:any){alert('Error: '+err.message)}
    setLoading(false)
  }

  const items=filteredItems()
  const MODOS=[{k:'pi',l:'Por PI completa'},{k:'contenedor',l:'Por contenedor'},{k:'parte',l:'Por parte'},{k:'libre',l:'Lista libre'}]
  const statusColor:Record<string,string>={solicitado:'amber',entregado_alm:'blue',recibido_prod:'green',cancelado:'red'}
  const statusLabel:Record<string,string>={solicitado:'Solicitado',entregado_alm:'Entregado por Almacén',recibido_prod:'Recibido',cancelado:'Cancelado'}

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:960,margin:'0 auto',paddingBottom:40}}>
      <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:ROLE_COLOR.PROD}}/>
        <span style={{fontSize:14,fontWeight:600}}>CEDIS Tijuana</span>
        <span style={{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:500,background:ROLE_BG.PROD,color:ROLE_TEXT.PROD}}>Producción</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <Badge color="purple">Solicitudes: {solicitudes.length}</Badge>
          {onBack&&<button onClick={onBack} style={{padding:'5px 12px',borderRadius:8,border:'1px solid #ddd',background:'#f0f0f0',color:'#444',fontSize:12,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>← Inicio</button>}
          {userName&&<UserMenu email={userName} rol={userRol||'PROD'} onLogout={onLogout||onBack}/>}
        </div>
      </div>
      <div style={{padding:'16px 20px 0'}}>
        <div style={{display:'flex',gap:2,borderBottom:'1px solid #eee',marginBottom:16}}>
          {[{k:'solicitar',l:'Nueva solicitud'},{k:'missolicitudes',l:`Mis solicitudes (${solicitudes.length})`}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{padding:'7px 14px',border:'none',background:tab===t.k?ROLE_BG.PROD:'transparent',color:tab===t.k?ROLE_TEXT.PROD:'#888',borderRadius:'8px 8px 0 0',cursor:'pointer',fontSize:13,fontWeight:tab===t.k?600:400}}>{t.l}</button>
          ))}
        </div>
        {tab==='solicitar'&&(
          <div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12,marginBottom:16}}>
              <Input label="Área / Línea" value={area} onChange={setArea} placeholder="Ej: Línea 3" required/>
              <Input label="Notas" value={notas} onChange={setNotas} placeholder="Orden de producción..."/>
            </div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,color:'#666',fontWeight:500,marginBottom:8}}>Modo de solicitud</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {MODOS.map(m=>(
                  <button key={m.k} onClick={()=>{setModo(m.k as any);setSelItems({});setSelectedPI('');setSelectedCont('')}}
                    style={{padding:'6px 14px',borderRadius:20,border:`1.5px solid ${modo===m.k?ROLE_COLOR.PROD:'#ddd'}`,background:modo===m.k?ROLE_BG.PROD:'transparent',color:modo===m.k?ROLE_TEXT.PROD:'#888',cursor:'pointer',fontSize:13,fontWeight:modo===m.k?600:400}}>{m.l}</button>
                ))}
              </div>
            </div>
            {modo==='pi'&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:'#666',fontWeight:500,marginBottom:6}}>Selecciona la PI</div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {uniquePIs.map(pi=>(
                    <button key={pi} onClick={()=>{setSelectedPI(pi);setSelItems({})}}
                      style={{padding:'6px 12px',borderRadius:8,border:`1.5px solid ${selectedPI===pi?ROLE_COLOR.PROD:'#ddd'}`,background:selectedPI===pi?ROLE_BG.PROD:'transparent',color:selectedPI===pi?ROLE_TEXT.PROD:'#555',cursor:'pointer',fontSize:12,fontWeight:selectedPI===pi?600:400}}>{pi}</button>
                  ))}
                </div>
              </div>
            )}
            {modo==='contenedor'&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:'#666',fontWeight:500,marginBottom:6}}>Selecciona PI y contenedor</div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                  {uniquePIs.map(pi=>(
                    <button key={pi} onClick={()=>{setSelectedPI(pi);setSelectedCont('');setSelItems({})}}
                      style={{padding:'5px 10px',borderRadius:8,border:`1.5px solid ${selectedPI===pi?ROLE_COLOR.PROD:'#ddd'}`,background:selectedPI===pi?ROLE_BG.PROD:'transparent',color:selectedPI===pi?ROLE_TEXT.PROD:'#555',cursor:'pointer',fontSize:12}}>{pi}</button>
                  ))}
                </div>
                {selectedPI&&(
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {contsByPI.map(c=>(
                      <button key={c.pi_number} onClick={()=>{setSelectedCont(c.pi_number);setSelItems({})}}
                        style={{padding:'5px 10px',borderRadius:8,border:`1.5px solid ${selectedCont===c.pi_number?'#1D9E75':'#ddd'}`,background:selectedCont===c.pi_number?'#E1F5EE':'transparent',color:selectedCont===c.pi_number?'#085041':'#555',cursor:'pointer',fontSize:12}}>
                        {c.contenedor}{c.comentario&&` · ${c.comentario}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {modo==='parte'&&(
              <div style={{marginBottom:14,maxWidth:400}}>
                <Input label="Buscar Part No o descripción" value={searchPart} onChange={setSearchPart} placeholder="Ej: 9011-240058"/>
              </div>
            )}
            {items.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:'#666',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{items.length} partes disponibles</span>
                  <div style={{display:'flex',gap:8}}>
                    {Object.keys(selItems).length>0&&<Btn small variant="danger" onClick={()=>setSelItems({})}>Deseleccionar todo</Btn>}
                    <Btn small variant="secondary" onClick={()=>{const all:Record<string,number>={};items.forEach((i:any)=>{all[i.id]=i.qty_disponible});setSelItems(all)}}>Seleccionar todo</Btn>
                  </div>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead><tr style={{borderBottom:'2px solid #eee',background:'#f9f9f9'}}>
                      {['','PI · Contenedor','Part No','Descripción','Disponible','UM','Cantidad'].map(h=>(
                        <th key={h} style={{padding:'8px 10px',textAlign:'left',color:'#888',fontSize:12,fontWeight:500,whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {items.map((item:any)=>{
                        const qty        = selItems[item.id]??item.qty_disponible
                        const isSelected = selItems[item.id]!==undefined
                        const isParcial  = isSelected&&qty<item.qty_disponible
                        const disc       = discrepancias.find(d=>d.part_no===item.part_no&&d.pi_number===item.pi_number&&d.status==='abierto')
                        const horasRestantes = disc?Math.max(0,Math.ceil((new Date(disc.vence_at).getTime()-Date.now())/3600000)):null
                        const vencido    = disc&&horasRestantes===0
                        return (
                          <tr key={item.id} style={{borderBottom:'1px solid #f5f5f5',background:isSelected?'#EEEDFE18':'transparent'}}>
                            <td style={{padding:'8px 10px',textAlign:'center'}}>
                              <input type="checkbox" checked={isSelected}
                                onChange={e=>{if(e.target.checked)setSelItems(s=>({...s,[item.id]:item.qty_disponible}));else setSelItems(s=>{const n={...s};delete n[item.id];return n})}}
                                style={{cursor:'pointer',width:16,height:16}}/>
                            </td>
                            <td style={{padding:'8px 10px'}}>
                              <div style={{display:'flex',flexDirection:'column',gap:3}}>
                                <Badge color="blue">{item.pi_number?.split('-').slice(0,-1).join('-')}</Badge>
                                <Badge color="teal">{item.pi_number?.split('-').pop()}</Badge>
                              </div>
                            </td>
                            <td style={{padding:'8px 10px',fontFamily:'monospace',fontSize:11}}>{item.part_no}</td>
                            <td style={{padding:'8px 10px'}}>
                              <span style={{display:'block',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:12}}>{item.descripcion}</span>
                              {disc&&(
                                <span style={{fontSize:10,background:vencido?'#FCEBEB':'#FAEEDA',color:vencido?'#A32D2D':'#854F0B',padding:'2px 8px',borderRadius:8,fontWeight:500,whiteSpace:'nowrap',display:'inline-block',marginTop:3}}>
                                  ⚠ Faltante: {(disc.qty_declarada-disc.qty_real).toLocaleString()} pzas · {vencido?'VENCIDO':`${horasRestantes}hrs`}
                                </span>
                              )}
                            </td>
                            <td style={{padding:'8px 10px'}}><Badge color={item.qty_disponible<20?'amber':'green'}>{item.qty_disponible?.toLocaleString()}</Badge></td>
                            <td style={{padding:'8px 10px',color:'#888'}}>{item.um}</td>
                            <td style={{padding:'8px 10px'}}>
                              {isSelected?(
                                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                                  <input type="number" min={1} max={item.qty_disponible} value={qty}
                                    onFocus={e=>e.target.select()} onKeyDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}
                                    onChange={e=>setQty(item.id,Number(e.target.value),item.qty_disponible)}
                                    style={{width:90,padding:'6px 8px',borderRadius:6,border:`2px solid ${isParcial?'#EF9F27':ROLE_COLOR.PROD}`,fontSize:13,background:'#fff',color:'#1a1a1a',outline:'none'}}/>
                                  {isParcial&&<Badge color="amber">parcial</Badge>}
                                </div>
                              ):<span style={{fontSize:12,color:'#ccc'}}>— sin seleccionar</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {items.length===0&&(
              <div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>
                {modo==='pi'&&!selectedPI&&'Selecciona una PI para ver las partes disponibles.'}
                {modo==='pi'&&selectedPI&&'No hay inventario disponible para esta PI.'}
                {modo==='contenedor'&&!selectedCont&&'Selecciona una PI y luego un contenedor.'}
                {modo==='parte'&&!searchPart&&'Escribe el Part No o descripción para buscar.'}
                {modo==='libre'&&'No hay inventario disponible.'}
              </div>
            )}
            {totalSel>0&&(
              <div style={{marginTop:16,padding:'12px 16px',background:ROLE_BG.PROD,borderRadius:10,display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{flex:1,fontSize:13,color:ROLE_TEXT.PROD}}>
                  <strong>{Object.keys(selItems).length}</strong> partes · <strong>{totalSel.toLocaleString()}</strong> pzas
                </div>
                <Btn onClick={submitSolicitud} disabled={loading} style={{background:ROLE_COLOR.PROD,color:'#fff'}}>
                  {loading?'Enviando...':'Enviar solicitud a Almacén'}
                </Btn>
              </div>
            )}
          </div>
        )}
        {tab==='missolicitudes'&&(
          <div>
            {solicitudes.length===0
              ?<div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>No has enviado solicitudes aún.</div>
              :solicitudes.map((sol:any)=>{
                const total=(sol.solicitud_items||[]).reduce((a:number,i:any)=>a+i.qty,0)
                const isExpanded=expandedSols[sol.id]
                return (
                  <div key={sol.id} style={{border:'1px solid #eee',borderRadius:10,marginBottom:10,overflow:'hidden'}}>
                    <div style={{padding:'12px 16px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',cursor:'pointer',background:'#fafafa'}}
                      onClick={()=>setExpandedSols(s=>({...s,[sol.id]:!s[sol.id]}))}>
                      <Badge color="purple">{sol.id?.slice(0,8).toUpperCase()}</Badge>
                      <Badge color={statusColor[sol.status]||'gray'}>{statusLabel[sol.status]||sol.status}</Badge>
                      <span style={{fontSize:13,fontWeight:600}}>{sol.area}</span>
                      <span style={{fontSize:12,color:'#888'}}>· {sol.modo_solicitud||'libre'} · {(sol.solicitud_items||[]).length} partes · {total.toLocaleString()} pzas</span>
                      <span style={{fontSize:12,color:'#888',marginLeft:'auto'}}>{new Date(sol.created_at).toLocaleString('es-MX')}</span>
                      <span style={{color:'#888'}}>{isExpanded?'▲':'▼'}</span>
                    </div>
                    {sol.notas&&<div style={{padding:'4px 16px 8px',fontSize:12,color:'#888',fontStyle:'italic',background:'#fafafa',borderBottom:'1px solid #eee'}}>{sol.notas}</div>}
                    {isExpanded&&(
                      <div>
                        <div style={{overflowX:'auto'}}>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                            <thead><tr style={{borderBottom:'1px solid #eee',background:'#f9f9f9'}}>
                              {['PI · Contenedor','Part No','Descripción','Cantidad','UM'].map(h=>(
                                <th key={h} style={{padding:'6px 12px',textAlign:'left',color:'#aaa',fontWeight:500}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {(sol.solicitud_items||[]).map((item:any,i:number)=>(
                                <tr key={i} style={{borderBottom:'1px solid #f5f5f5'}}>
                                  <td style={{padding:'6px 12px'}}>
                                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                                      <Badge color="blue">{item.pi_number?.split('-').slice(0,-1).join('-')}</Badge>
                                      <Badge color="teal">{item.pi_number?.split('-').pop()}</Badge>
                                    </div>
                                  </td>
                                  <td style={{padding:'6px 12px',fontFamily:'monospace',fontSize:11}}>{item.part_no}</td>
                                  <td style={{padding:'6px 12px'}}><span style={{display:'block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.descripcion}</span></td>
                                  <td style={{padding:'6px 12px',fontWeight:500}}>{item.qty?.toLocaleString()}</td>
                                  <td style={{padding:'6px 12px',color:'#888'}}>{item.um}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {sol.status==='entregado_alm'&&(
                          <div style={{padding:'12px 16px',borderTop:'1px solid #eee'}}>
                            <Btn onClick={()=>confirmarRecepcion(sol)} disabled={loading} style={{background:ROLE_COLOR.PROD,color:'#fff'}}>Confirmar recepción</Btn>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            }
          </div>
        )}
      </div>
    </div>
  )
}

// ── USER MENU ─────────────────────────────────────────────────
function UserMenu({ email, rol, onLogout }: { email: string, rol: string, onLogout: ()=>void }) {
  const [open,        setOpen]        = useState(false)
  const [showPwd,     setShowPwd]     = useState(false)
  const [pwdActual,   setPwdActual]   = useState('')
  const [pwdNueva,    setPwdNueva]    = useState('')
  const [pwdConfirm,  setPwdConfirm]  = useState('')
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState<{type:'ok'|'err', text:string}|null>(null)

  const rolColor: Record<string,string> = {CE:'#185FA5',ALM:'#0F6E56',PROD:'#534AB7',ADMIN:'#854F0B'}
  const rolBg:    Record<string,string> = {CE:'#E6F1FB',ALM:'#E1F5EE',PROD:'#EEEDFE',ADMIN:'#FAEEDA'}

  const cambiarPassword = async () => {
    if (!pwdNueva||pwdNueva.length<6) { setMsg({type:'err',text:'La contraseña debe tener al menos 6 caracteres'}); return }
    if (pwdNueva!==pwdConfirm)        { setMsg({type:'err',text:'Las contraseñas no coinciden'}); return }
    setSaving(true); setMsg(null)
    // Re-autenticar con contraseña actual
    const {error:reAuthErr} = await supabase.auth.signInWithPassword({email,password:pwdActual})
    if (reAuthErr) { setMsg({type:'err',text:'Contraseña actual incorrecta'}); setSaving(false); return }
    // Actualizar contraseña
    const {error:updErr} = await supabase.auth.updateUser({password:pwdNueva})
    if (updErr) { setMsg({type:'err',text:'Error al actualizar: '+updErr.message}); setSaving(false); return }
    setMsg({type:'ok',text:'Contraseña actualizada correctamente'})
    setPwdActual(''); setPwdNueva(''); setPwdConfirm('')
    setSaving(false)
    setTimeout(()=>{ setShowPwd(false); setMsg(null) }, 2000)
  }

  const nombre = email.split('@')[0]

  return (
    <div style={{position:'relative'}}>
      <button onClick={()=>setOpen(!open)}
        style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',borderRadius:8,
          border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>
        <div style={{width:26,height:26,borderRadius:'50%',background:rolBg[rol]||'#f0f0f0',
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,
          color:rolColor[rol]||'#888'}}>
          {nombre.slice(0,2).toUpperCase()}
        </div>
        <span style={{fontSize:12,color:'#444',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{email}</span>
        <span style={{fontSize:10,color:'#888'}}>▾</span>
      </button>

      {open&&(
        <>
          {/* Overlay para cerrar */}
          <div onClick={()=>{setOpen(false);setShowPwd(false);setMsg(null)}}
            style={{position:'fixed',inset:0,zIndex:99}}/>
          {/* Dropdown */}
          <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:100,
            background:'#fff',border:'0.5px solid #e0e0e0',borderRadius:10,
            boxShadow:'0 4px 16px rgba(0,0,0,0.08)',minWidth:260,overflow:'hidden'}}>

            {/* Info usuario */}
            <div style={{padding:'12px 16px',borderBottom:'0.5px solid #eee',background:'#fafafa'}}>
              <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginBottom:4}}>{nombre}</div>
              <div style={{fontSize:12,color:'#888',marginBottom:6}}>{email}</div>
              <span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:500,
                background:rolBg[rol]||'#f0f0f0',color:rolColor[rol]||'#888'}}>{rol}</span>
            </div>

            {/* Opciones */}
            {!showPwd&&(
              <div>

                <button onClick={()=>setShowPwd(true)}
                  style={{width:'100%',padding:'11px 16px',border:'none',background:'transparent',
                    textAlign:'left',fontSize:13,color:'#1a1a1a',cursor:'pointer',display:'flex',gap:8,alignItems:'center'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f5f5f5'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  🔑 Cambiar contraseña
                </button>
                <div style={{borderTop:'0.5px solid #eee'}}/>
                <button onClick={()=>{setOpen(false);onLogout()}}
                  style={{width:'100%',padding:'11px 16px',border:'none',background:'transparent',
                    textAlign:'left',fontSize:13,color:'#A32D2D',cursor:'pointer',display:'flex',gap:8,alignItems:'center'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#FCEBEB'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  Cerrar sesión
                </button>
              </div>
            )}

            {/* Formulario cambio de contraseña */}
            {showPwd&&(
              <div style={{padding:'14px 16px'}}>
                <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginBottom:12}}>Cambiar contraseña</div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  <div>
                    <label style={{fontSize:11,color:'#888',display:'block',marginBottom:3}}>Contraseña actual</label>
                    <input type="password" value={pwdActual} onChange={e=>setPwdActual(e.target.value)}
                      placeholder="••••••••"
                      style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:6,
                        border:'1px solid #ddd',fontSize:13,outline:'none'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:'#888',display:'block',marginBottom:3}}>Nueva contraseña</label>
                    <input type="password" value={pwdNueva} onChange={e=>setPwdNueva(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:6,
                        border:'1px solid #ddd',fontSize:13,outline:'none'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:'#888',display:'block',marginBottom:3}}>Confirmar contraseña</label>
                    <input type="password" value={pwdConfirm} onChange={e=>setPwdConfirm(e.target.value)}
                      placeholder="Repite la contraseña"
                      onKeyDown={e=>e.key==='Enter'&&cambiarPassword()}
                      style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:6,
                        border:'1px solid #ddd',fontSize:13,outline:'none'}}/>
                  </div>
                  {msg&&(
                    <div style={{padding:'8px 10px',borderRadius:6,fontSize:12,
                      background:msg.type==='ok'?'#EAF3DE':'#FCEBEB',
                      color:msg.type==='ok'?'#3B6D11':'#A32D2D'}}>
                      {msg.text}
                    </div>
                  )}
                  <div style={{display:'flex',gap:8,marginTop:2}}>
                    <button onClick={cambiarPassword} disabled={saving}
                      style={{flex:1,padding:'8px',borderRadius:6,border:'none',
                        background:'#185FA5',color:'#fff',fontSize:12,fontWeight:500,
                        cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
                      {saving?'Guardando...':'Actualizar'}
                    </button>
                    <button onClick={()=>{setShowPwd(false);setMsg(null);setPwdActual('');setPwdNueva('');setPwdConfirm('')}}
                      style={{padding:'8px 12px',borderRadius:6,border:'1px solid #ddd',
                        background:'#f0f0f0',color:'#1a1a1a',fontSize:12,cursor:'pointer'}}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── ADMIN VIEW ────────────────────────────────────────────────
function AdminView({ userName, onSelectModule, onLogout }: {
  userName?: string, onSelectModule: (m:string)=>void, onLogout: ()=>void
}) {
  const [usuarios,    setUsuarios]    = useState<any[]>([])
  const [loading,     setLoading]     = useState(false)
  const [showForm,    setShowForm]    = useState(false)
  const [newEmail,    setNewEmail]    = useState('')
  const [newNombre,   setNewNombre]   = useState('')
  const [newRol,      setNewRol]      = useState('CE')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  useEffect(()=>{ loadUsuarios() },[])

  const loadUsuarios = async () => {
    setLoading(true)
    const {data} = await supabase.from('user_roles').select('*').order('created_at',{ascending:false})
    setUsuarios(data||[])
    setLoading(false)
  }

  const agregarUsuario = async () => {
    if (!newEmail.trim()||!newNombre.trim()) { setError('Email y nombre son obligatorios'); return }
    setSaving(true); setError('')
    try {
      const { data, error:e } = await supabase.functions.invoke('invite-user', {
        body: { email: newEmail.trim().toLowerCase(), nombre: newNombre.trim(), rol: newRol }
      })
      if (e || data?.error) throw new Error(data?.error || e?.message)
      setNewEmail(''); setNewNombre(''); setNewRol('CE'); setShowForm(false)
      setError('✓ Invitación enviada — el usuario recibirá un email para crear su contraseña')
      await loadUsuarios()
    } catch(e:any) { setError(e.message||'Error al invitar') }
    setSaving(false)
  }

  const toggleActivo = async (id:string, activo:boolean) => {
    await supabase.from('user_roles').update({activo:!activo}).eq('id',id)
    await loadUsuarios()
  }

  const rolColor: Record<string,string> = {CE:'blue',ALM:'teal',PROD:'purple',ADMIN:'amber'}
  const modules = [
    {key:'CE',   title:'Comercio Exterior', bg:'#E6F1FB', tx:'#0C447C', dot:'#185FA5'},
    {key:'ALM',  title:'Almacén',           bg:'#E1F5EE', tx:'#085041', dot:'#0F6E56'},
    {key:'PROD', title:'Producción',        bg:'#EEEDFE', tx:'#3C3489', dot:'#534AB7'},
    {key:'DISC', title:'Discrepancias',     bg:'#FCEBEB', tx:'#A32D2D', dot:'#A32D2D'},
  ]

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:960,margin:'0 auto',paddingBottom:40}}>
      {/* Header */}
      <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:'#854F0B'}}/>
        <span style={{fontSize:14,fontWeight:600,color:'#1a1a1a'}}>CEDIS Tijuana</span>
        <span style={{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:500,background:'#FAEEDA',color:'#854F0B'}}>Administrador</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {userName&&<UserMenu email={userName} rol="ADMIN" onLogout={onLogout}/>}
        </div>
      </div>

      <div style={{padding:'20px'}}>
        {/* Acceso a módulos */}
        <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginBottom:10}}>Acceder como</div>
        <div style={{display:'flex',gap:10,marginBottom:28,flexWrap:'wrap'}}>
          {modules.map(m=>(
            <div key={m.key} onClick={()=>onSelectModule(m.key)}
              style={{flex:1,minWidth:160,padding:14,borderRadius:10,border:`1.5px solid ${m.dot}40`,
                background:m.bg,cursor:'pointer',transition:'transform .1s'}}
              onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
              onMouseLeave={e=>e.currentTarget.style.transform=''}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:m.dot}}/>
                <span style={{fontSize:13,fontWeight:600,color:m.tx}}>{m.title}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Gestión de usuarios */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a'}}>Usuarios ({usuarios.length})</div>
          <button onClick={()=>setShowForm(!showForm)}
            style={{padding:'6px 14px',borderRadius:8,fontSize:12,fontWeight:500,cursor:'pointer',
              background:'#1a1a1a',color:'#fff',border:'none'}}>
            {showForm?'Cancelar':'+ Agregar usuario'}
          </button>
        </div>

        {/* Formulario nuevo usuario */}
        {showForm&&(
          <div style={{border:'1px solid #eee',borderRadius:10,padding:16,marginBottom:16,background:'#fafafa'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 120px',gap:10,marginBottom:10}}>
              <Input label="Email" value={newEmail} onChange={setNewEmail} placeholder="usuario@empresa.com" required/>
              <Input label="Nombre" value={newNombre} onChange={setNewNombre} placeholder="Nombre completo" required/>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:12,color:'#666',fontWeight:500}}>Rol <span style={{color:'#A32D2D'}}>*</span></label>
                <select value={newRol} onChange={e=>setNewRol(e.target.value)}
                  style={{padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background:'#fff',color:'#1a1a1a'}}>
                  <option>CE</option><option>ALM</option><option>PROD</option><option>ADMIN</option>
                </select>
              </div>
            </div>
            {error&&<div style={{padding:'8px 12px',borderRadius:8,background:'#FCEBEB',color:'#A32D2D',fontSize:12,marginBottom:10}}>{error}</div>}
            <div style={{background:'#E6F1FB',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#0C447C',marginBottom:10}}>
              Al guardar se enviará automáticamente un email de invitación para que el usuario cree su contraseña.
            </div>
            <button onClick={agregarUsuario} disabled={saving}
              style={{padding:'8px 16px',borderRadius:8,border:'none',background:'#185FA5',
                color:'#fff',fontSize:13,fontWeight:500,cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
              {saving?'Guardando...':'Guardar usuario'}
            </button>
          </div>
        )}

        {/* Tabla usuarios */}
        <div style={{border:'0.5px solid #e0e0e0',borderRadius:10,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px 100px 80px',
            padding:'8px 16px',background:'#f9f9f9',borderBottom:'0.5px solid #eee'}}>
            {['Email','Nombre','Rol','Activo',''].map(h=>(
              <span key={h} style={{fontSize:11,color:'#aaa',fontWeight:500}}>{h}</span>
            ))}
          </div>
          {loading&&<div style={{padding:20,textAlign:'center',color:'#bbb',fontSize:13}}>Cargando...</div>}
          {!loading&&usuarios.length===0&&<div style={{padding:20,textAlign:'center',color:'#bbb',fontSize:13}}>Sin usuarios registrados.</div>}
          {usuarios.map((u:any)=>(
            <div key={u.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px 100px 80px',
              padding:'10px 16px',borderBottom:'0.5px solid #f5f5f5',alignItems:'center',
              opacity:u.activo?1:0.5}}>
              <span style={{fontSize:13,color:'#444'}}>{u.email}</span>
              <span style={{fontSize:13,color:'#444'}}>{u.nombre||'—'}</span>
              <span><Badge color={rolColor[u.rol]||'gray'}>{u.rol}</Badge></span>
              <span style={{fontSize:12,color:u.activo?'#3B6D11':'#A32D2D',fontWeight:500}}>
                {u.activo?'Activo':'Inactivo'}
              </span>
              <button onClick={()=>toggleActivo(u.id,u.activo)}
                style={{padding:'3px 8px',borderRadius:6,fontSize:11,fontWeight:500,cursor:'pointer',
                  background:u.activo?'#FCEBEB':'#EAF3DE',
                  color:u.activo?'#A32D2D':'#3B6D11',border:'none'}}>
                {u.activo?'Desactivar':'Activar'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── LOGIN ─────────────────────────────────────────────────────
function LoginView({ onLogin }: { onLogin: (user:any, rol:string)=>void }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleLogin = async () => {
    if (!email.trim()||!password.trim()) { setError('Ingresa tu email y contraseña'); return }
    setLoading(true); setError('')
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authErr) { setError('Email o contraseña incorrectos'); setLoading(false); return }

      const { data: rolData, error: rolErr } = await supabase
        .from('user_roles').select('rol,nombre').eq('email', email.trim().toLowerCase()).eq('activo', true).single()

      if (rolErr || !rolData) {
        await supabase.auth.signOut()
        setError('Tu usuario no tiene acceso configurado. Contacta al administrador.')
        setLoading(false); return
      }

      onLogin(data.user, rolData.rol)
    } catch { setError('Error al conectar. Intenta de nuevo.') }
    setLoading(false)
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',
      background:'#f5f5f5',fontFamily:'system-ui,sans-serif',padding:20}}>
      <div style={{width:'100%',maxWidth:380,background:'#fff',borderRadius:16,
        padding:32,border:'0.5px solid #e0e0e0'}}>
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{width:48,height:48,borderRadius:12,background:'#E6F1FB',
            display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
            <div style={{width:20,height:20,borderRadius:4,background:'#185FA5'}}/>
          </div>
          <div style={{fontSize:20,fontWeight:600,color:'#1a1a1a',marginBottom:4}}>CEDIS Tijuana</div>
          <div style={{fontSize:13,color:'#888'}}>Sistema de Control de Operaciones</div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <label style={{fontSize:12,color:'#666',fontWeight:500,display:'block',marginBottom:4}}>
              Correo electrónico
            </label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="tu@correo.com"
              onKeyDown={e=>e.key==='Enter'&&handleLogin()}
              style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',borderRadius:8,
                border:'1px solid #ddd',fontSize:13,outline:'none',color:'#1a1a1a'}}/>
          </div>
          <div>
            <label style={{fontSize:12,color:'#666',fontWeight:500,display:'block',marginBottom:4}}>
              Contraseña
            </label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e=>e.key==='Enter'&&handleLogin()}
              style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',borderRadius:8,
                border:'1px solid #ddd',fontSize:13,outline:'none',color:'#1a1a1a'}}/>
          </div>

          {error&&(
            <div style={{padding:'10px 12px',borderRadius:8,background:'#FCEBEB',
              color:'#A32D2D',fontSize:12}}>
              {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading}
            style={{padding:'11px',borderRadius:8,border:'none',background:'#185FA5',
              color:'#fff',fontSize:14,fontWeight:500,cursor:loading?'not-allowed':'pointer',
              opacity:loading?0.7:1,marginTop:4}}>
            {loading?'Entrando...':'Entrar'}
          </button>
          <button onClick={async()=>{
            if(!email.trim()){setError('Ingresa tu email para recuperar tu contraseña');return}
            setLoading(true);setError('')
            const {error:e} = await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin})
            if(e) setError('Error: '+e.message)
            else setError('✓ Te enviamos un link para restablecer tu contraseña')
            setLoading(false)
          }} disabled={loading}
            style={{padding:'8px',borderRadius:8,border:'none',background:'transparent',
              color:'#888',fontSize:12,cursor:'pointer',textDecoration:'underline'}}>
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        <div style={{marginTop:20,textAlign:'center',fontSize:12,color:'#bbb'}}>
          ¿Problemas para entrar? Contacta al administrador.
        </div>
      </div>
    </div>
  )
}

// ── DISCREPANCIAS ─────────────────────────────────────────────
function DISCView({ onBack, onLogout, userName, userRol }: {
  onBack: ()=>void, onLogout?: ()=>void, userName?: string, userRol?: string
}) {
  const [discrepancias, setDiscrepancias] = useState<any[]>([])
  const [pis,           setPIs]           = useState<any[]>([])
  const [loading,       setLoading]       = useState(false)
  const [openPIs,       setOpenPIs]       = useState<Record<string,boolean>>({})
  const [openConts,     setOpenConts]     = useState<Record<string,boolean>>({})

  useEffect(()=>{ loadData() },[])

  const loadData = async () => {
    setLoading(true)
    const [{data:disc},{data:pisData}] = await Promise.all([
      supabase.from('discrepancias').select('*').order('created_at',{ascending:false}),
      supabase.from('pis').select('id,pi_number,modelo,contenedor,proveedor_id,proveedores(nombre)').eq('tipo','pi'),
    ])
    setDiscrepancias(disc||[])
    setPIs(pisData||[])
    setLoading(false)
  }

  // Enriquecer discrepancias con datos del PI
  const enriched = discrepancias.map(d => {
    const pi = pis.find(p => p.pi_number === d.pi_number)
    return {
      ...d,
      modelo:    pi?.modelo    || d.modelo || '—',
      proveedor: (pi as any)?.proveedores?.nombre || '—',
      piBase:    d.pi_number?.split('-').slice(0,-1).join('-') || d.pi_number,
      contenedor: d.pi_number?.split('-').pop() || '—',
    }
  })

  // Métricas
  const abiertas  = enriched.filter(d=>d.status==='abierto')
  const resueltas = enriched.filter(d=>d.status==='resuelto')
  const piezasFaltantes = abiertas.reduce((a,d)=>a+(d.qty_declarada-d.qty_real),0)
  const valorRiesgo = abiertas.reduce((a,d)=>a+((d.qty_declarada-d.qty_real)*(d.valor_unitario||0)),0)

  // Agrupar por PI base → contenedor
  const grouped: Record<string,Record<string,any[]>> = {}
  for (const d of enriched) {
    if (!grouped[d.piBase]) grouped[d.piBase] = {}
    if (!grouped[d.piBase][d.contenedor]) grouped[d.piBase][d.contenedor] = []
    grouped[d.piBase][d.contenedor].push(d)
  }

  // Exportar Excel
  const exportExcel = (items: any[], filename: string) => {
    const rows = items.map(d => ({
      'PI':              d.piBase,
      'Contenedor':      d.contenedor,
      'Proveedor':       d.proveedor,
      'Modelo':          d.modelo,
      'Part No':         d.part_no,
      'Descripción':     d.descripcion,
      'Qty Declarada':   d.qty_declarada,
      'Qty Recibida':    d.qty_real,
      'Diferencia':      d.qty_declarada - d.qty_real,
      'Precio Unitario': d.valor_unitario || 0,
      'Total Faltante':  (d.qty_declarada - d.qty_real) * (d.valor_unitario || 0),
      'Estatus':         d.status,
      'Fecha':           d.created_at?.slice(0,10) || '—',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Discrepancias')
    XLSX.writeFile(wb, `${filename}.xlsx`)
  }

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:960,margin:'0 auto',paddingBottom:40}}>
      {/* Header */}
      <div style={{padding:'14px 20px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:'#A32D2D'}}/>
        <span style={{fontSize:14,fontWeight:600,color:'#1a1a1a'}}>CEDIS Tijuana</span>
        <span style={{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:500,background:'#FCEBEB',color:'#A32D2D'}}>Discrepancias</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {onBack&&<button onClick={onBack} style={{padding:'5px 12px',borderRadius:8,border:'1px solid #ddd',background:'#f0f0f0',color:'#444',fontSize:12,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>← Inicio</button>}
          {userName&&<UserMenu email={userName} rol={userRol||'DISC'} onLogout={onLogout||onBack}/>}
        </div>
      </div>

      <div style={{padding:'20px'}}>
        {/* Métricas */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:20}}>
          {[
            {label:'Faltantes abiertos', val:String(abiertas.length),                color:'#A32D2D'},
            {label:'Piezas faltantes',   val:piezasFaltantes.toLocaleString(),        color:'#1a1a1a'},
            {label:'Valor en riesgo',    val:`$${valorRiesgo.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`, color:'#854F0B'},
            {label:'Resueltos',          val:String(resueltas.length),               color:'#3B6D11'},
          ].map(m=>(
            <div key={m.label} style={{background:'#f9f9f9',borderRadius:8,padding:'10px 14px'}}>
              <div style={{fontSize:11,color:'#888',marginBottom:2}}>{m.label}</div>
              <div style={{fontSize:18,fontWeight:500,color:m.color}}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Botón exportar todo */}
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
          <button onClick={()=>exportExcel(enriched,'discrepancias-todas')}
            style={{padding:'8px 16px',borderRadius:8,border:'none',background:'#1a1a1a',
              color:'#fff',fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',gap:6,alignItems:'center'}}>
            ↓ Exportar todo a Excel
          </button>
        </div>

        {loading&&<div style={{padding:24,textAlign:'center',color:'#bbb'}}>Cargando...</div>}

        {!loading&&Object.keys(grouped).length===0&&(
          <div style={{padding:24,textAlign:'center',color:'#bbb',fontSize:13}}>No hay discrepancias registradas.</div>
        )}

        {/* Agrupado PI → Contenedor → Partes */}
        {Object.entries(grouped).map(([piBase, contMap])=>{
          const piItems = Object.values(contMap).flat()
          const piAbiertas = piItems.filter(d=>d.status==='abierto').length
          const piResueltas = piItems.filter(d=>d.status==='resuelto').length
          const isOpen = openPIs[piBase]

          return (
            <div key={piBase} style={{marginBottom:8,border:'0.5px solid #e0e0e0',borderRadius:10,overflow:'hidden'}}>
              {/* Header PI */}
              <div style={{padding:'11px 16px',background:'#f9f9f9',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <span onClick={()=>setOpenPIs(s=>({...s,[piBase]:!s[piBase]}))}
                  style={{fontSize:12,color:'#aaa',cursor:'pointer',minWidth:14}}>{isOpen?'▼':'▶'}</span>
                <span onClick={()=>setOpenPIs(s=>({...s,[piBase]:!s[piBase]}))} style={{cursor:'pointer',display:'flex',gap:8,alignItems:'center',flex:1,flexWrap:'wrap'}}>
                  <Badge color="blue">{piBase}</Badge>
                  <Badge color="purple">{piItems[0]?.modelo||'—'}</Badge>
                  <span style={{fontSize:12,color:'#888'}}>{piItems[0]?.proveedor||'—'}</span>
                  <span style={{fontSize:12,color:'#888'}}>{Object.keys(contMap).length} contenedor{Object.keys(contMap).length!==1?'es':''}</span>
                  {piAbiertas>0&&<Badge color="coral">{piAbiertas} abierto{piAbiertas!==1?'s':''}</Badge>}
                  {piResueltas>0&&<Badge color="green">{piResueltas} resuelto{piResueltas!==1?'s':''}</Badge>}
                </span>
                <button onClick={()=>exportExcel(piItems, `disc-${piBase}`)}
                  style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:500,cursor:'pointer',
                    background:'#f0f0f0',color:'#1a1a1a',border:'1px solid #ddd',whiteSpace:'nowrap'}}>
                  ↓ Excel
                </button>
              </div>

              {/* Contenedores */}
              {isOpen&&Object.entries(contMap).map(([cont, items])=>{
                const ck = `${piBase}-${cont}`
                const isContOpen = openConts[ck]
                const contAbiertas = items.filter(d=>d.status==='abierto').length

                return (
                  <div key={cont} style={{borderTop:'0.5px solid #eee'}}>
                    {/* Header contenedor */}
                    <div style={{padding:'8px 16px 8px 40px',display:'flex',gap:10,alignItems:'center',background:'#fafafa',flexWrap:'wrap'}}>
                      <span onClick={()=>setOpenConts(s=>({...s,[ck]:!s[ck]}))}
                        style={{fontSize:11,color:'#aaa',cursor:'pointer',minWidth:14}}>{isContOpen?'▼':'▶'}</span>
                      <span onClick={()=>setOpenConts(s=>({...s,[ck]:!s[ck]}))} style={{cursor:'pointer',display:'flex',gap:8,alignItems:'center',flex:1}}>
                        <Badge color="teal">{cont}</Badge>
                        <span style={{fontSize:12,color:'#888'}}>{items.length} parte{items.length!==1?'s':''}</span>
                        {contAbiertas>0&&<Badge color="coral">{contAbiertas} abierto{contAbiertas!==1?'s':''}</Badge>}
                      </span>
                      <button onClick={()=>exportExcel(items, `disc-${piBase}-${cont}`)}
                        style={{padding:'3px 8px',borderRadius:6,fontSize:11,fontWeight:500,cursor:'pointer',
                          background:'#f0f0f0',color:'#1a1a1a',border:'1px solid #ddd',whiteSpace:'nowrap'}}>
                        ↓ Excel
                      </button>
                    </div>

                    {/* Tabla partes */}
                    {isContOpen&&(
                      <div style={{borderTop:'0.5px solid #f0f0f0',overflowX:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <thead><tr style={{background:'#f9f9f9',borderBottom:'0.5px solid #eee'}}>
                            {['Part No','Descripción','Declarado','Recibido','Diferencia','Unit Price','Total Faltante','Estatus','Fecha'].map(h=>(
                              <th key={h} style={{padding:'6px 12px',textAlign:'left',color:'#aaa',fontWeight:500,whiteSpace:'nowrap'}}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {items.map((d:any)=>{
                              const diff = d.qty_declarada - d.qty_real
                              const totalFalt = diff * (d.valor_unitario||0)
                              const vencido = d.status==='abierto' && new Date(d.vence_at).getTime()<Date.now()
                              return (
                                <tr key={d.id} style={{borderBottom:'0.5px solid #f5f5f5',
                                  background:d.status==='resuelto'?'transparent':vencido?'#FFFBF5':'transparent'}}>
                                  <td style={{padding:'7px 12px',fontFamily:'monospace',fontSize:11}}>{d.part_no}</td>
                                  <td style={{padding:'7px 12px'}}><span style={{display:'block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.descripcion}</span></td>
                                  <td style={{padding:'7px 12px',textAlign:'right'}}>{(d.qty_declarada||0).toLocaleString()}</td>
                                  <td style={{padding:'7px 12px',textAlign:'right'}}>{(d.qty_real||0).toLocaleString()}</td>
                                  <td style={{padding:'7px 12px',textAlign:'right'}}><strong style={{color:diff>0?'#A32D2D':'#3B6D11'}}>{diff.toLocaleString()}</strong></td>
                                  <td style={{padding:'7px 12px',textAlign:'right'}}>{d.valor_unitario?`$${d.valor_unitario.toFixed(4)}`:'—'}</td>
                                  <td style={{padding:'7px 12px',textAlign:'right',color:'#854F0B',fontWeight:500}}>{totalFalt>0?`$${totalFalt.toFixed(2)}`:'—'}</td>
                                  <td style={{padding:'7px 12px'}}>
                                    <Badge color={d.status==='resuelto'?'green':vencido?'red':'amber'}>
                                      {d.status==='resuelto'?'resuelto':vencido?'vencido':'abierto'}
                                    </Badge>
                                  </td>
                                  <td style={{padding:'7px 12px',color:'#888'}}>{d.created_at?.slice(0,10)||'—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── APP PRINCIPAL ─────────────────────────────────────────────
export default function App() {
  const [authState,    setAuthState]    = useState<'loading'|'login'|'app'>('loading')
  const [user,         setUser]         = useState<any>(null)
  const [role,         setRole]         = useState<string|null>(null)
  const [almTab,       setAlmTab]       = useState<string|undefined>(undefined)
  const [adminModule,  setAdminModule]  = useState<string|null>(null)

  useEffect(()=>{
    // Verificar sesión activa al cargar
    supabase.auth.getSession().then(async ({data:{session}})=>{
      if (session?.user) {
        const {data} = await supabase.from('user_roles').select('rol').eq('email',session.user.email!.toLowerCase()).eq('activo',true).single()
        if (data) { setUser(session.user); setRole(data.rol); setAuthState('app') }
        else { await supabase.auth.signOut(); setAuthState('login') }
      } else { setAuthState('login') }
    })
    // Escuchar cambios de sesión
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session)=>{
      if (!session) { setUser(null); setRole(null); setAuthState('login') }
    })
    return ()=>subscription.unsubscribe()
  },[])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null); setRole(null); setAuthState('login')
  }

  const goToFaltantes = () => { setAlmTab('faltantes'); setRole('ALM') }

  if (authState==='loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',
      fontFamily:'system-ui,sans-serif',color:'#888',fontSize:14}}>
      Cargando...
    </div>
  )

  if (authState==='login') return (
    <LoginView onLogin={(u,r)=>{ setUser(u); setRole(r); setAuthState('app') }}/>
  )

  // ADMIN: muestra RoleSelector + panel de usuarios
  if (role==='ADMIN'&&!adminModule) return (
    <AdminView
      userName={user?.email}
      onSelectModule={(m:string)=>setAdminModule(m)}
      onLogout={handleLogout}
    />
  )
  // ADMIN navegando a un módulo específico
  const effectiveRole = role==='ADMIN' ? adminModule : role
  const handleHome = () => {
    if (role==='ADMIN') setAdminModule(null)
    // Para roles normales, onHome no hace nada diferente — ya están en su único módulo
    // El logout sigue siendo el botón de cerrar sesión
  }

  if (effectiveRole==='CE')   return <CEView   onBack={handleHome} onLogout={handleLogout} onGoToFaltantes={goToFaltantes} userName={user?.email} userRol={role||'CE'}/>
  if (effectiveRole==='ALM')  return <ALMView  onBack={handleHome} onLogout={handleLogout} initialTab={almTab} userName={user?.email} userRol={role||'ALM'}/>
  if (effectiveRole==='PROD') return <PRODView onBack={handleHome} onLogout={handleLogout} userName={user?.email} userRol={role||'PROD'}/>
  if (effectiveRole==='DISC') return <DISCView onBack={handleHome} onLogout={handleLogout} userName={user?.email} userRol={role||'DISC'}/>

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:600,margin:'60px auto',padding:'0 20px',textAlign:'center'}}>
      <div style={{fontSize:16,color:'#888',marginBottom:16}}>Rol no configurado.</div>
      <Btn variant="secondary" onClick={handleLogout}>Cerrar sesión</Btn>
    </div>
  )
}
