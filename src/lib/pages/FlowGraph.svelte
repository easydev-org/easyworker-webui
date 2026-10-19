<script lang="ts">
  // FlowGraph — a layered SVG view of one job's dataflow.
  //
  // Ported from easysh-webui's FlowGraph: the worker now stores the same graph
  // (it runs jobs through easysh), so a job's pipes, redirects and each stage's
  // stdin/stdout/stderr are visible, and every intermediate result is readable.
  //
  // Nodes are flows, placed in columns by their depth in the DAG, so data reads
  // left-to-right like the pipeline that produced it. Clicking a flow shows its
  // intermediate bytes.
  import type { Flow } from '$lib/gen/worker/v1/worker_pb.js'
  import type { WorkerClient } from '$lib/worker'

  let { client, jobId }: { client: WorkerClient; jobId: string } = $props()

  let flows = $state<Flow[]>([])
  let edges = $state<{ from: bigint; to: bigint }[]>([])
  let loading = $state(true)
  let picked = $state<Flow | null>(null)
  let content = $state('')
  let timer: number | undefined
  let hover = $state<bigint | null>(null)

  // ── layout constants ──────────────────────────────────────────────────────
  const W = 190
  const H = 62
  const COL = 96
  const ROW = 20
  const PAD = 16

  async function load() {
    try {
      const g = await client.jobGraph({ jobId })
      flows = g.flows
      edges = g.edges.map(e => ({ from: e.fromFid, to: e.toFid }))
    } finally {
      loading = false
    }
  }

  async function open(f: Flow) {
    picked = f
    try {
      const r = await client.jobFlow({ jobId, fid: f.fid })
      content = new TextDecoder().decode(r.data)
    } catch (e) {
      content = `(failed: ${e})`
    }
  }

  $effect(() => {
    load()
    timer = window.setInterval(load, 1500) // the graph grows while the job runs
    return () => window.clearInterval(timer)
  })

  function label(f: Flow): string {
    if (f.kind === 'fd') {
      const who = f.owner && f.owner !== 'job' ? f.owner : 'job'
      return `${f.fd} · ${who}${f.iter ? ' ' + f.iter : ''}`
    }
    if (f.kind === 'file') return f.path || 'file'
    if (f.kind === 'capture') return '$()'
    return f.producer || f.consumer || f.kind
  }

  function isData(f: Flow): boolean {
    return f.kind !== 'fd'
  }

  // ── layered layout (Kahn on the edge set) ─────────────────────────────────
  const layout = $derived.by(() => {
    const ins = new Map<bigint, bigint[]>()
    const outs = new Map<bigint, bigint[]>()
    for (const f of flows) {
      ins.set(f.fid, [])
      outs.set(f.fid, [])
    }
    for (const e of edges) {
      ins.get(e.to)?.push(e.from)
      outs.get(e.from)?.push(e.to)
    }
    const layer = new Map<bigint, number>()
    const indeg = new Map<bigint, number>()
    for (const f of flows) indeg.set(f.fid, ins.get(f.fid)!.length)
    const q = flows.filter(f => indeg.get(f.fid) === 0).map(f => f.fid)
    for (const id of q) layer.set(id, 0)
    let head = 0
    while (head < q.length) {
      const id = q[head++]!
      const l = layer.get(id) ?? 0
      for (const o of outs.get(id) ?? []) {
        layer.set(o, Math.max(layer.get(o) ?? 0, l + 1))
        indeg.set(o, (indeg.get(o) ?? 1) - 1)
        if (indeg.get(o) === 0) q.push(o)
      }
    }
    for (const f of flows) if (!layer.has(f.fid)) layer.set(f.fid, 0)

    const cols = new Map<number, bigint[]>()
    for (const f of flows) {
      const l = layer.get(f.fid)!
      if (!cols.has(l)) cols.set(l, [])
      cols.get(l)!.push(f.fid)
    }
    const maxCol = Math.max(0, ...[...cols.keys()])
    const pos = new Map<bigint, { x: number; y: number }>()
    let maxRows = 0
    for (const [l, ids] of cols) {
      ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      maxRows = Math.max(maxRows, ids.length)
      ids.forEach((id, i) => {
        pos.set(id, { x: PAD + l * (W + COL), y: PAD + i * (H + ROW) })
      })
    }
    const width = PAD * 2 + (maxCol + 1) * W + maxCol * COL
    const height = PAD * 2 + maxRows * H + Math.max(0, maxRows - 1) * ROW
    return { pos, width, height }
  })

  function edgePath(a: bigint, b: bigint): string {
    const p1 = layout.pos.get(a)
    const p2 = layout.pos.get(b)
    if (!p1 || !p2) return ''
    const x1 = p1.x + W
    const y1 = p1.y + H / 2
    const x2 = p2.x
    const y2 = p2.y + H / 2
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  function edgeActive(a: bigint, b: bigint): boolean {
    const ids = [picked?.fid, hover].filter((x): x is bigint => x != null)
    return ids.includes(a) || ids.includes(b)
  }

  // Distinct source segments (a stage's span), in source order.
  interface Seg { line: number; col: number; endLine: number; endCol: number; label: string; fids: bigint[] }
  const segs = $derived.by(() => {
    const m = new Map<string, Seg>()
    for (const f of flows) {
      if (!f.line) continue
      const k = `${f.line}:${f.col}-${f.endLine}:${f.endCol}`
      const lbl = f.owner && f.owner !== 'job' ? f.owner : f.producer || f.kind
      let s = m.get(k)
      if (!s) {
        s = { line: f.line, col: f.col, endLine: f.endLine, endCol: f.endCol, label: lbl, fids: [] }
        m.set(k, s)
      }
      s.fids.push(f.fid)
    }
    return [...m.values()].sort((a, b) => a.col - b.col || a.line - b.line)
  })

  function segActive(s: Seg): boolean {
    return (picked != null && s.fids.includes(picked.fid)) || (hover != null && s.fids.includes(hover))
  }
  function pickSeg(s: Seg) {
    const f = flows.find(x => x.fid === s.fids[0])
    if (f) open(f)
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if segs.length > 0}
    <div class="shrink-0 border-b border-border p-2">
      <div class="mb-1 text-micro text-muted-foreground">source segments (click to highlight a flow)</div>
      <div class="flex flex-wrap gap-1">
        {#each segs as s, i (i)}
          <button
            class="rounded border px-1.5 py-0.5 font-mono text-micro transition-colors {segActive(s)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'}"
            title="line {s.line} col {s.col}"
            onclick={() => pickSeg(s)}
            onmouseenter={() => (hover = s.fids[0]!)}
            onmouseleave={() => (hover = null)}
          >
            [{i + 1}] {s.label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto p-1">
    {#if loading}
      <p class="p-3 text-meta text-muted-foreground">Loading…</p>
    {:else if flows.length === 0}
      <p class="p-3 text-meta text-muted-foreground">No flows recorded yet.</p>
    {:else}
      <div class="relative" style="width:{layout.width}px; height:{layout.height}px;">
        <svg class="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {#each edges as e, i (i)}
            <path
              d={edgePath(e.from, e.to)}
              fill="none"
              stroke={edgeActive(e.from, e.to) ? 'var(--primary)' : 'var(--border)'}
              stroke-width={edgeActive(e.from, e.to) ? 2 : 1.2}
              marker-end="url(#arrow)"
              style="color:{edgeActive(e.from, e.to) ? 'var(--primary)' : 'var(--border)'}"
            />
          {/each}
        </svg>

        {#each flows as f (f.fid)}
          {@const p = layout.pos.get(f.fid) ?? { x: 0, y: 0 }}
          <button
            class="absolute overflow-hidden rounded-md border bg-card px-2 py-1 text-left transition-shadow
              {isData(f) ? 'border-primary/70' : 'border-dashed border-muted-foreground/50'}
              {picked?.fid === f.fid ? 'ring-2 ring-primary' : ''}
              {hover === f.fid ? 'ring-1 ring-primary' : ''}"
            style="left:{p.x}px; top:{p.y}px; width:{W}px; height:{H}px;"
            onclick={() => open(f)}
            onmouseenter={() => (hover = f.fid)}
            onmouseleave={() => (hover = null)}
            title="click to view this flow's content"
          >
            <div class="truncate font-mono text-micro text-muted-foreground">
              f{f.fid} · {f.kind}{#if f.fd} · {f.fd}{/if}
            </div>
            <div class="truncate font-mono text-meta {isData(f) ? 'text-foreground' : 'text-muted-foreground'}">
              {label(f)}
            </div>
            <div class="truncate text-micro text-muted-foreground">
              {f.bytes} B · {f.lines} lines{#if f.iter} · {f.iter}{/if}
            </div>
          </button>
        {/each}
      </div>

      <details class="mt-2 px-2">
        <summary class="cursor-pointer text-micro text-muted-foreground">edges ({edges.length})</summary>
        <div class="mt-1 font-mono text-micro text-muted-foreground">
          {#each edges as e}
            f{e.from} → f{e.to}<br />
          {/each}
        </div>
      </details>
    {/if}
  </div>

  {#if picked}
    <div class="shrink-0 border-t border-border">
      <div class="flex items-center gap-2 px-3 py-1.5 text-micro text-muted-foreground">
        <span class="font-mono">f{picked.fid} · {picked.kind} · {content.length} B</span>
        <span class="ml-auto"></span>
        <button class="hover:text-foreground" onclick={() => (picked = null)}>close</button>
      </div>
      <pre class="term-line max-h-60 overflow-auto bg-background p-3">{content}</pre>
    </div>
  {/if}
</div>
