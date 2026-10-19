<script lang="ts">
  // App — the root: a login gate, then the shell + mutually-exclusive
  // Files/Jobs drawers. On desktop the drawer is half the width; on phones it
  // is full-width so it is actually usable.
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { AppIcons } from '$lib/icons'
  import LoginGate from '$lib/LoginGate.svelte'
  import ShellPage from '$lib/pages/ShellPage.svelte'
  import FilesDrawer from '$lib/pages/FilesDrawer.svelte'
  import JobsDrawer from '$lib/pages/JobsDrawer.svelte'
  import { session, setToken } from '$lib/session.svelte'

  let entered = $state(session.connected)
  let drawer = $state<'files' | 'jobs' | null>(null)
  // The desktop is deliberately NOT a surface of this panel: there is no
  // in-panel stream page. The Desktop button opens the easystream daemon's own
  // UI in a new tab (the worker reverse-proxies it at /desktop/).
  //
  // The old DesktopPage/StreamPage pair was a half-finished duplicate of that
  // UI and had rotted: StreamPage opened its socket on /stream/ws, a path that
  // stopped existing when the worker's stream package moved to Prefix "/est/".
  // Clicking Desktop opened a page whose WebSocket never connected. One UI, one
  // owner.
  const hasDesktop = $derived(!!session.capabilities?.desktop || !!session.capabilities?.novnc)

  onMount(() => {
    document.documentElement.dataset.theme = 'dark'
  })

  function signOut() {
    setToken('')
    session.connected = false
    session.workspace = ''
    entered = false
    drawer = null
  }

  function toggle(which: 'files' | 'jobs') {
    drawer = drawer === which ? null : which
  }

  function showDesktop() {
    // Open the easystream daemon's OWN UI in a new tab, proxied by the worker
    // at /desktop/ (same origin, same port — no extra Service, no CORS).
    drawer = null
    window.open('/desktop/', '_blank', 'noopener')
  }
</script>

{#if !entered}
  <LoginGate onEnter={() => (entered = true)} />
{:else}
  <div class="flex h-dvh flex-col overflow-hidden bg-background">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <span class="flex items-center gap-2 font-semibold">
        <span class="flex size-5 items-center justify-center rounded-md bg-primary font-mono text-[10px] font-bold text-primary-foreground">AW</span>
        Agent Worker
      </span>
      <span class="hidden font-mono text-micro text-muted-foreground sm:inline">{session.os}/{session.arch}</span>
      <span class="ml-auto"></span>
      {#if hasDesktop}
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5"
          onclick={showDesktop}
        >
          <AppIcons.desktop class="size-4" />Desktop
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 {drawer === 'files' ? 'bg-muted text-foreground' : ''}"
        onclick={() => toggle('files')}
      >
        <AppIcons.files class="size-4" />Files
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 {drawer === 'jobs' ? 'bg-muted text-foreground' : ''}"
        onclick={() => toggle('jobs')}
      >
        <AppIcons.jobs class="size-4" />Jobs
      </Button>
      <Button variant="ghost" size="sm" class="gap-1.5" onclick={signOut}>
        <AppIcons.signOut class="size-4" /><span class="max-sm:hidden">Sign out</span>
      </Button>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <ShellPage />
      {#if drawer === 'files'}
        <aside class="flex min-h-0 w-full flex-col border-border bg-card max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:border-l-0 sm:w-1/2 sm:border-l">
          <FilesDrawer onClose={() => (drawer = null)} />
        </aside>
      {:else if drawer === 'jobs'}
        <aside class="flex min-h-0 w-full flex-col border-border bg-card max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:border-l-0 sm:w-1/2 sm:border-l">
          <JobsDrawer onClose={() => (drawer = null)} />
        </aside>
      {/if}
    </div>
  </div>
{/if}
