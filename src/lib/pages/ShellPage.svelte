<script lang="ts">
  // ShellPage — a shell-style console. The worker is STATELESS (each Execute is
  // an independent interpreted job with no persistent cwd), so this keeps a
  // CLIENT-side virtual cwd and passes it as each command's workdir. Output
  // streams live via WatchJob; `Detach` disconnects the stream while the job
  // keeps running in the background (use the Jobs drawer to watch/kill it).
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { AppIcons } from '$lib/icons'
  import { session, client, resolveAbs, displayPath, stripAnsi } from '$lib/session.svelte'
  import { watchJob } from '$lib/worker'

  let termEl: HTMLDivElement | null = $state(null)
  let inputEl: HTMLInputElement | null = $state(null)
  let command = $state('')
  let running = $state(false)
  /**
   * The language the prompt's text is written in, and its mode.
   *
   * BOTH COME FROM THE WORKER, never from a guess. The engine reports only interpreters it managed to
   * RUN a probe program with, so this list is "what will work" rather than "what is installed". The
   * default is the first one it reported — usually bash — and switching is a control the reader uses
   * deliberately, because the same text means different things in different languages.
   */
  let lang = $state('')
  let mode = $state('')

  /** The modes the chosen language declares; empty means the interpreter has no either/or choice. */
  const modes = $derived(session.interpreters.find(i => i.id === lang)?.modes ?? [])

  // FOLLOW THE WORKER: once Info arrives (or the sandbox is reconnected), make sure the selection is
  // still one this worker actually has, and pick the first when nothing is chosen yet.
  $effect(() => {
    const list = session.interpreters
    if (list.length === 0) {
      lang = ''
      mode = ''
      return
    }
    if (!list.some(i => i.id === lang)) {
      lang = list[0].id
      mode = ''
    }
    // A mode the language does not declare is an error at the engine, so it is dropped here rather
    // than sent.
    if (mode && !(list.find(i => i.id === lang)?.modes ?? []).includes(mode)) mode = ''
  })
  let watchAbort: AbortController | null = null
  const history: string[] = []
  let histIdx = -1

  interface Line {
    kind: 'cmd' | 'out' | 'err' | 'exit'
    text: string
  }
  let lines = $state<Line[]>([])

  function scrollBottom() {
    if (termEl) queueMicrotask(() => (termEl!.scrollTop = termEl!.scrollHeight))
  }
  function push(kind: Line['kind'], text: string) {
    lines = [...lines, { kind, text }]
    scrollBottom()
  }

  onMount(() => inputEl?.focus())

  async function run(cmd: string) {
    push('cmd', `${displayPath(session.cwd || session.workspace || '/')} $ ${cmd}`)
    if (cmd === 'clear') {
      lines = []
      return
    }
    // Lock the prompt for the whole command so nothing runs concurrently
    // (serialized shell). Detach releases it early for long jobs; the job keeps
    // running in the background.
    running = true
    const ac = new AbortController()
    watchAbort = ac
    try {
      const cd = cmd.match(/^cd(?:\s+(.+))?$/)
      if (cd) {
        await applyCd(cd[1])
        return
      }
      // `lang` IS REQUIRED AND HAS NO DEFAULT. The engine rejects a request without it rather than
      // guessing: `echo hi && ls` is bash, is a syntax error in Windows PowerShell 5.1, and means
      // something else in PowerShell 7 — a guess would run the command as the wrong language and
      // report success. The picker above the prompt is where it comes from.
      const r = await client().execute({
        command: cmd,
        workdir: session.cwd || session.workspace,
        lang: lang,
        mode: mode,
      })
      await watchJob(
        session.token,
        r.jobId,
        ev => {
          if (ev.output !== undefined) push('out', stripAnsi(ev.output))
          if (ev.done) push('exit', `[done exit=${ev.done.exitCode}]`)
        },
        ac.signal,
      )
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError')
        push('err', `error: ${String((e as Error)?.message ?? e)}`)
    } finally {
      // Only the CURRENT run may clear the lock/controller (a detached run's
      // abort fires synchronously; guard against clobbering a newer run).
      if (watchAbort === ac) {
        watchAbort = null
        running = false
        queueMicrotask(() => inputEl?.focus())
      }
    }
  }

  async function applyCd(target: string | undefined) {
    const next = resolveAbs(session.cwd || session.workspace || '/', target)
    try {
      const r = await client().fileList({ path: next, depth: 1, limit: 1 })
      if (!r.isDir) {
        push('err', `cd: not a directory: ${target || '/'}`)
        return
      }
      session.cwd = next
    } catch (e) {
      push('err', `cd: ${String((e as Error)?.message ?? e)}`)
    }
  }

  function submit() {
    // One command at a time: while a job streams, the input is disabled, so a
    // second submit cannot race the first (which would overwrite watchAbort and
    // interleave two jobs' output in the transcript).
    if (running) return
    const cmd = command.trim()
    command = ''
    if (!cmd) return
    history.push(cmd)
    histIdx = history.length
    void run(cmd)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (histIdx > 0) {
        histIdx--
        command = history[histIdx] ?? ''
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < history.length - 1) {
        histIdx++
        command = history[histIdx] ?? ''
      } else {
        histIdx = history.length
        command = ''
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      detach()
    }
  }

  function detach() {
    // Stop streaming THIS command's output (history stays; no more lines are
    // appended). The job itself keeps running in the background — watch or kill
    // it from the Jobs drawer.
    if (watchAbort) {
      watchAbort.abort()
      push('exit', '[detached — output stopped; job continues in the background]')
    }
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div bind:this={termEl} class="min-h-0 flex-1 overflow-auto px-3.5 py-3" aria-live="polite">
    {#each lines as ln, i (i)}
      <div
        class="term-line {ln.kind === 'cmd'
          ? 'text-primary'
          : ln.kind === 'err'
            ? 'text-destructive'
            : ln.kind === 'exit'
              ? 'text-muted-foreground'
              : ''}"
      >
        {ln.text}
      </div>
    {/each}
  </div>
  <form
    class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-3 py-2"
    onsubmit={e => {
      e.preventDefault()
      submit()
    }}
  >
    <span class="shrink-0 truncate font-mono text-meta text-muted-foreground"
      >{displayPath(session.cwd || session.workspace || '/')}</span
    >
    <!-- THE LANGUAGE PICKER. It sits at the prompt because it changes what the text beside it MEANS:
         `ls` is a command in bash and an alias in PowerShell 7, and `echo hi && ls` does not parse in
         Windows PowerShell at all. Hidden when the worker offers one language or none — a picker with
         a single option is a control that cannot do anything. -->
    {#if session.interpreters.length > 1}
      <select
        bind:value={lang}
        disabled={running}
        class="shrink-0 rounded border border-border bg-transparent px-1 py-0.5 font-mono text-micro text-muted-foreground outline-none disabled:opacity-50"
        title="The language this command is written in. The worker only lists interpreters it ran a probe with."
        aria-label="Language"
      >
        {#each session.interpreters as it (it.id)}
          <option value={it.id}>{it.name || it.id}</option>
        {/each}
      </select>
    {/if}
    {#if modes.length > 1}
      <select
        bind:value={mode}
        disabled={running}
        class="shrink-0 rounded border border-border bg-transparent px-1 py-0.5 font-mono text-micro text-muted-foreground outline-none disabled:opacity-50"
        title="Mode for this language. Empty is the interpreter's own default."
        aria-label="Mode"
      >
        <option value="">default</option>
        {#each modes as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    {/if}
    <span class="shrink-0 font-mono text-primary">$</span>
    <input
      bind:this={inputEl}
      bind:value={command}
      onkeydown={onKey}
      disabled={running}
      class="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-meta outline-none placeholder:text-muted-foreground disabled:opacity-50"
      placeholder={running ? 'running…' : 'type a command, e.g. ls -la'}
      autocomplete="off"
      spellcheck="false"
    />
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="shrink-0 gap-1.5"
      disabled={!running}
      title="Disconnect the output stream — the job keeps running in the background"
      onclick={detach}
    >
      <AppIcons.detach class="size-4" />Detach
    </Button>
  </form>
</div>
