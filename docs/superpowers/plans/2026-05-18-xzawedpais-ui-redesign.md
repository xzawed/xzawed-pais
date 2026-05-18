# xzawedPAIS UI/UX 리디자인 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** xzawedOrchestrator Electron 앱을 VSCode Dark+ 테마 기반 IDE 하이브리드 4패널 레이아웃으로 전면 재설계하여 Slack 수준의 프리미엄 데스크톱 앱으로 끌어올린다.

**Architecture:** ActivityBar(44px) + Sidebar(210px) + MainArea(flex) + RightPanel(200px) 4패널 레이아웃. 채팅 메시지는 에이전트 실행 흐름을 타임라인 스텝 카드로 시각화하며, Framer Motion 으로 풍부한 진입·상태전환 애니메이션을 적용한다. 기존 Zustand 스토어·IPC 채널·WebSocket 로직은 변경 없이 유지한다.

**Tech Stack:** React 19 + Electron 42 + Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Radix 기반) + Framer Motion 11 + Shiki (코드 하이라이팅) + react-markdown + Sonner (토스트) + cmdk (⌘K 팔레트)

**Working directory:** `xzawedOrchestrator/packages/app`

---

## 파일 맵

### 신규 생성
```
src/renderer/src/styles/globals.css          — Tailwind v4 진입점 + 디자인 토큰
src/renderer/src/lib/utils.ts                — cn() 유틸리티
src/renderer/src/lib/markdown.ts             — Shiki + remark-gfm 설정
src/renderer/src/lib/parseAgentSteps.ts      — content → AgentStep[] 파서
src/renderer/src/lib/parseAgentSteps.test.ts — 파서 단위 테스트
src/renderer/src/components/ui/             — shadcn/ui 기본 컴포넌트
  button.tsx, scroll-area.tsx, tooltip.tsx,
  dialog.tsx, command.tsx, badge.tsx, separator.tsx
src/renderer/src/components/layout/
  ActivityBar.tsx                            — 좌측 아이콘 레일
  RightPanel.tsx                             — 우측 라이브 로그 패널
  StatusBar.tsx                              — 하단 상태바
src/renderer/src/components/chat/
  UserBubble.tsx                             — 사용자 메시지 말풍선
  AgentTimelineCard.tsx                      — 에이전트 타임라인 카드
  PipelineStrip.tsx                          — 파이프라인 진행 스트립
  CodeBlock.tsx                              — Shiki 신택스 하이라이팅
  MarkdownContent.tsx                        — react-markdown 래퍼
src/renderer/src/components/CommandPalette.tsx — ⌘K 팔레트
```

### 수정
```
electron.vite.config.ts                      — @tailwindcss/vite 플러그인 추가
src/renderer/src/main.tsx                    — globals.css import, Toaster 추가
src/renderer/src/App.tsx                     — 4패널 레이아웃으로 재구성
src/renderer/src/components/Sidebar.tsx      — Slack 채널 스타일 재설계
src/renderer/src/components/ChatView.tsx     — 새 컴포넌트 사용하도록 리팩터
src/renderer/src/components/MessageInput.tsx — Tailwind 재설계
src/renderer/src/components/SettingsModal.tsx — shadcn Dialog 적용
src/renderer/src/components/GitHubPanel.tsx  — Tailwind 리스타일
src/renderer/src/components/McpPanel.tsx     — Tailwind 리스타일
src/renderer/src/components/PluginPanel.tsx  — Tailwind 리스타일
src/renderer/src/store/chat.store.ts         — logLines: string[] 추가
```

### 삭제
```
src/renderer/src/App.css                     — Tailwind로 완전 대체 (Phase 2 말)
src/renderer/src/components/MessageBubble.tsx — UserBubble + AgentTimelineCard로 대체
```

---

## Phase 1 — 기반 설정

### Task 1: 의존성 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 패키지 설치**

```bash
cd xzawedOrchestrator/packages/app
pnpm add framer-motion react-markdown remark-gfm shiki sonner cmdk
pnpm add -D @tailwindcss/vite tailwindcss clsx tailwind-merge class-variance-authority @types/react-dom
```

- [ ] **Step 2: 설치 확인**

```bash
pnpm list framer-motion tailwindcss shiki sonner cmdk
```

Expected: 각 패키지 버전이 출력됨 (framer-motion ≥11, tailwindcss ≥4, shiki ≥1)

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/package.json xzawedOrchestrator/packages/app/pnpm-lock.yaml
git commit -m "chore(app): UI 리디자인 의존성 추가 — tailwind v4, framer-motion, shiki, sonner"
```

---

### Task 2: Tailwind v4 + Vite 플러그인 설정

**Files:**
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/src/styles/globals.css`

- [ ] **Step 1: electron.vite.config.ts 수정**

`xzawedOrchestrator/packages/app/electron.vite.config.ts` 전체 교체:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
```

- [ ] **Step 2: globals.css 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/styles/globals.css` 생성:

```css
@import "tailwindcss";

@theme {
  /* Background layers */
  --color-bg:            #1e1e1e;
  --color-surface:       #252526;
  --color-surface-raised:#2d2d2d;
  --color-code:          #1a1a1a;

  /* Borders */
  --color-border:        #3c3c3c;
  --color-border-dim:    #2a2a2a;

  /* Text */
  --color-fg:            #d4d4d4;
  --color-fg-muted:      #bbb;
  --color-fg-dim:        #888;
  --color-fg-ghost:      #555;

  /* Accent (blue) */
  --color-accent:        #0078d4;
  --color-accent-hover:  #006cbe;
  --color-accent-bg:     #094771;

  /* Semantic */
  --color-ok:            #3fb950;
  --color-ok-bg:         #0e4429;
  --color-warn:          #f0ad4e;
  --color-danger:        #f85149;
  --color-statusbar:     #007acc;

  /* Agent colors */
  --color-agent-mgr:     #0078d4;
  --color-agent-planner: #3fb950;
  --color-agent-dev:     #9cdcfe;
  --color-agent-tester:  #f0ad4e;
  --color-agent-builder: #c586c0;
  --color-agent-watcher: #4ec9b0;
  --color-agent-security:#f85149;
  --color-agent-designer:#dcdcaa;
}

@layer base {
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html, body, #root {
    height: 100%;
    margin: 0;
    overflow: hidden;
  }
  body {
    background-color: var(--color-bg);
    color: var(--color-fg);
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 12px;
    -webkit-font-smoothing: antialiased;
  }
  code, pre, kbd {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace;
    font-size: 11px;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--color-fg-ghost); }
}

@layer utilities {
  .animate-pulse-glow-green {
    animation: pulse-glow-green 2s ease-in-out infinite;
  }
  .animate-pulse-glow-blue {
    animation: pulse-glow-blue 1.5s ease-in-out infinite;
  }
  .animate-blink {
    animation: blink 1s step-end infinite;
  }
  .animate-log-slide {
    animation: log-slide 0.3s ease forwards;
  }
  @keyframes pulse-glow-green {
    0%, 100% { box-shadow: 0 0 4px 0 rgba(63, 185, 80, 0.4); }
    50%       { box-shadow: 0 0 10px 2px rgba(63, 185, 80, 0.6); }
  }
  @keyframes pulse-glow-blue {
    0%, 100% { box-shadow: 0 0 0 0 rgba(0, 120, 212, 0.3); }
    50%       { box-shadow: 0 0 0 3px rgba(0, 120, 212, 0.15); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  @keyframes log-slide {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
}
```

- [ ] **Step 3: main.tsx에서 globals.css import**

`xzawedOrchestrator/packages/app/src/renderer/src/main.tsx` 수정 — 기존 `import './App.css'`를 교체:

```tsx
import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 4: 빌드 오류 확인**

```bash
cd xzawedOrchestrator/packages/app
pnpm build
```

Expected: BUILD SUCCESS (App.css 클래스들이 아직 있어 UI가 깨지지만 빌드는 성공)

- [ ] **Step 5: Commit**

```bash
git add xzawedOrchestrator/packages/app/electron.vite.config.ts \
        xzawedOrchestrator/packages/app/src/renderer/src/styles/globals.css \
        xzawedOrchestrator/packages/app/src/renderer/src/main.tsx
git commit -m "feat(app): Tailwind CSS v4 설정 — @tailwindcss/vite 플러그인 + 디자인 토큰"
```

---

### Task 3: cn 유틸리티 + shadcn/ui 기본 컴포넌트

**Files:**
- Create: `src/renderer/src/lib/utils.ts`
- Create: `src/renderer/src/components/ui/button.tsx`
- Create: `src/renderer/src/components/ui/scroll-area.tsx`
- Create: `src/renderer/src/components/ui/badge.tsx`
- Create: `src/renderer/src/components/ui/separator.tsx`
- Create: `src/renderer/src/components/ui/tooltip.tsx`
- Create: `src/renderer/src/components/ui/dialog.tsx`
- Create: `src/renderer/src/components/ui/command.tsx`

- [ ] **Step 1: cn 유틸리티 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: Radix UI 설치**

```bash
cd xzawedOrchestrator/packages/app
pnpm add @radix-ui/react-slot @radix-ui/react-scroll-area @radix-ui/react-tooltip \
         @radix-ui/react-dialog @radix-ui/react-separator
```

- [ ] **Step 3: button.tsx 생성**

`src/renderer/src/components/ui/button.tsx`:

```tsx
import React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:  'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]',
        ghost:    'text-fg-muted hover:bg-surface-raised hover:text-fg',
        outline:  'border border-border text-fg-muted hover:bg-surface-raised',
        danger:   'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
      },
      size: {
        sm:   'h-6 px-2 text-[10px]',
        md:   'h-7 px-3',
        lg:   'h-8 px-4 text-sm',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  }
)
Button.displayName = 'Button'
```

- [ ] **Step 4: scroll-area.tsx 생성**

`src/renderer/src/components/ui/scroll-area.tsx`:

```tsx
import React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '../../lib/utils.js'

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation="vertical"
      className="flex touch-none select-none transition-colors w-1.5 p-px"
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = 'ScrollArea'
```

- [ ] **Step 5: badge.tsx 생성**

`src/renderer/src/components/ui/badge.tsx`:

```tsx
import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        ok:      'bg-ok-bg text-ok border border-ok/30',
        active:  'bg-accent-bg text-accent border border-accent/40',
        warn:    'bg-warn/10 text-warn border border-warn/30',
        danger:  'bg-danger/10 text-danger border border-danger/30',
        muted:   'bg-surface text-fg-ghost border border-border',
      },
    },
    defaultVariants: { variant: 'muted' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
```

- [ ] **Step 6: separator.tsx 생성**

`src/renderer/src/components/ui/separator.tsx`:

```tsx
import React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '../../lib/utils.js'

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className
    )}
    {...props}
  />
))
Separator.displayName = 'Separator'
```

- [ ] **Step 7: tooltip.tsx 생성**

`src/renderer/src/components/ui/tooltip.tsx`:

```tsx
import React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils.js'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded bg-surface-raised border border-border px-2 py-1 text-[10px] text-fg shadow-md',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'
```

- [ ] **Step 8: dialog.tsx 생성**

`src/renderer/src/components/ui/dialog.tsx`:

```tsx
import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils.js'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
        'w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-2xl',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5 mb-4', className)} {...props} />
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h2 className={cn('text-sm font-semibold text-fg', className)} {...props} />
}
```

- [ ] **Step 9: command.tsx 생성**

`src/renderer/src/components/ui/command.tsx`:

```tsx
import React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '../../lib/utils.js'

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface text-fg', className)}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-3">
    <span className="mr-2 text-fg-ghost text-sm">⌘</span>
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-10 w-full bg-transparent text-sm text-fg placeholder:text-fg-ghost',
        'outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  </div>
))
CommandInput.displayName = CommandPrimitive.Input.displayName

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List ref={ref} className={cn('max-h-64 overflow-y-auto overflow-x-hidden', className)} {...props} />
))
CommandList.displayName = CommandPrimitive.List.displayName

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-xs text-fg-ghost" {...props} />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn('overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-ghost', className)}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-xs text-fg-muted outline-none',
      'data-[selected=true]:bg-surface-raised data-[selected=true]:text-fg',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      className
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName
```

- [ ] **Step 10: 빌드 확인**

```bash
cd xzawedOrchestrator/packages/app
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 11: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/
git commit -m "feat(app): cn 유틸리티 + shadcn/ui 기본 컴포넌트 (Button, ScrollArea, Badge, Tooltip, Dialog, Command)"
```

---

## Phase 2 — 레이아웃 셸

### Task 4: chat.store 에 logLines 추가

**Files:**
- Modify: `src/renderer/src/store/chat.store.ts`

- [ ] **Step 1: chat.store.ts 수정**

`xzawedOrchestrator/packages/app/src/renderer/src/store/chat.store.ts` 의 `ChatState` 인터페이스와 `initialState`에 `logLines` 추가:

```ts
import { create } from 'zustand'
import type { Message, UISpec } from '@xzawed/shared'

interface ChatState {
  sessionId: string | null
  messages: Message[]
  streamingContent: string
  streamingMsgId: string | null
  isStreaming: boolean
  isPending: boolean
  uiSpec: UISpec | null
  logLines: string[]           // 우측 패널 실시간 로그
  tokenCount: number           // 토큰 사용량 추적
  elapsedMs: number            // 세션 경과 시간
  modifiedFiles: string[]      // Developer가 수정한 파일 목록
  initSession: (sessionId: string) => void
  addMessage: (msg: Message) => void
  setPending: (v: boolean) => void
  startStream: (msgId: string) => void
  appendChunk: (content: string) => void
  finalizeStream: (msgId: string) => void
  cancelStream: () => void
  setUiSpec: (spec: UISpec | null) => void
  addLogLine: (line: string) => void
  setTokenCount: (n: number) => void
  setElapsedMs: (ms: number) => void
  addModifiedFile: (path: string) => void
  reset: () => void
}

const initialState = {
  sessionId: null,
  messages: [] as Message[],
  streamingContent: '',
  streamingMsgId: null,
  isStreaming: false,
  isPending: false,
  uiSpec: null,
  logLines: [] as string[],
  tokenCount: 0,
  elapsedMs: 0,
  modifiedFiles: [] as string[],
}

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  initSession: (sessionId) => set({ ...initialState, sessionId }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setPending: (isPending) => set({ isPending }),

  startStream: (msgId) =>
    set({ streamingMsgId: msgId, streamingContent: '', isStreaming: true, isPending: false }),

  appendChunk: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),

  cancelStream: () =>
    set({ isStreaming: false, isPending: false, streamingMsgId: null, streamingContent: '' }),

  finalizeStream: (msgId) =>
    set((state) => {
      if (state.streamingMsgId !== msgId) return state
      const assistantMsg: Message = {
        id: msgId,
        sessionId: state.sessionId ?? '',
        role: 'assistant',
        content: state.streamingContent,
        timestamp: Date.now(),
      }
      return {
        messages: [...state.messages, assistantMsg],
        streamingContent: '',
        streamingMsgId: null,
        isStreaming: false,
      }
    }),

  setUiSpec: (uiSpec) => set({ uiSpec }),

  addLogLine: (line) =>
    set((state) => ({ logLines: [...state.logLines.slice(-199), line] })),

  setTokenCount: (tokenCount) => set({ tokenCount }),

  setElapsedMs: (elapsedMs) => set({ elapsedMs }),

  addModifiedFile: (path) =>
    set((state) => ({
      modifiedFiles: state.modifiedFiles.includes(path)
        ? state.modifiedFiles
        : [...state.modifiedFiles, path],
    })),

  reset: () => set({ ...initialState }),
}))
```

- [ ] **Step 2: 테스트 실행 (기존 테스트 유지 확인)**

```bash
cd xzawedOrchestrator
pnpm test
```

Expected: 74/74 PASS (기존 서버 테스트 영향 없음)

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/store/chat.store.ts
git commit -m "feat(app/store): chat.store에 logLines·tokenCount·elapsedMs·modifiedFiles 추가"
```

---

### Task 5: App.tsx — 4패널 레이아웃

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: App.tsx 재작성**

`xzawedOrchestrator/packages/app/src/renderer/src/App.tsx`:

```tsx
import React, { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useAppStore } from './store/app.store.js'
import { useIntegrationsStore } from './store/integrations.store.js'
import { checkHealth } from './lib/api.js'
import { ActivityBar } from './components/layout/ActivityBar.js'
import { Sidebar } from './components/Sidebar.js'
import { RightPanel } from './components/layout/RightPanel.js'
import { StatusBar } from './components/layout/StatusBar.js'
import { ChatView } from './components/ChatView.js'
import { DynamicPanel } from './components/DynamicPanel.js'
import { SettingsModal } from './components/SettingsModal.js'
import { GitHubPanel } from './components/GitHubPanel.js'
import { McpPanel } from './components/McpPanel.js'
import { PluginPanel } from './components/PluginPanel.js'
import { CommandPalette } from './components/CommandPalette.js'
import { TooltipProvider } from './components/ui/tooltip.js'

export function App(): React.JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()
  const { activePanel } = useIntegrationsStore()

  useEffect(() => {
    window.electronAPI
      ?.getSettings()
      .then((saved) => updateSettings(saved))
      .catch(() => {})
  }, [updateSettings])

  useEffect(() => {
    let cancelled = false
    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) setServerStatus(healthy ? 'running' : 'stopped')
    }
    void poll()
    const id = setInterval(() => void poll(), 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [settings.serverUrl, setServerStatus])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full overflow-hidden bg-bg">

        {/* 1. Activity Bar (44px) */}
        <ActivityBar />

        {/* 2. Sidebar (210px) */}
        <Sidebar />

        {/* 3. Main Area (flex-1) */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {activePanel === 'chat' && (
            <div className="flex flex-1 overflow-hidden">
              <ChatView />
              <DynamicPanel />
            </div>
          )}
          {activePanel === 'github'  && <GitHubPanel />}
          {activePanel === 'mcp'     && <McpPanel />}
          {activePanel === 'plugins' && <PluginPanel />}
        </div>

        {/* 4. Right Panel (200px) — chat 패널에서만 표시 */}
        {activePanel === 'chat' && <RightPanel />}

        {/* Overlays */}
        <SettingsModal />
        <CommandPalette />
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-fg)',
              fontSize: '12px',
            },
          }}
        />
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: 빌드 확인 (RightPanel·ActivityBar·CommandPalette 파일 없어서 오류 예상)**

```bash
cd xzawedOrchestrator/packages/app
pnpm build 2>&1 | head -20
```

Expected: 오류 발생 (아직 없는 파일 import) — 다음 Task에서 생성

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/App.tsx
git commit -m "feat(app): 4패널 레이아웃 구조 (ActivityBar·Sidebar·MainArea·RightPanel)"
```

---

### Task 6: ActivityBar 컴포넌트

**Files:**
- Create: `src/renderer/src/components/layout/ActivityBar.tsx`

- [ ] **Step 1: ActivityBar.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/layout/ActivityBar.tsx`:

```tsx
import React from 'react'
import { motion } from 'framer-motion'
import { useIntegrationsStore, type ActivePanel } from '../../store/integrations.store.js'
import { useAppStore } from '../../store/app.store.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { cn } from '../../lib/utils.js'

interface NavItem { panel: ActivePanel; icon: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { panel: 'chat',    icon: '💬', label: '채팅' },
  { panel: 'github',  icon: '🐙', label: 'GitHub' },
  { panel: 'mcp',     icon: '🔌', label: 'MCP 서버' },
  { panel: 'plugins', icon: '🧩', label: '플러그인' },
]

export function ActivityBar(): React.JSX.Element {
  const { activePanel, setActivePanel } = useIntegrationsStore()
  const { toggleSettings } = useAppStore()

  return (
    <div className="flex w-11 flex-shrink-0 flex-col items-center gap-1 border-r border-border-dim bg-surface-raised py-2">
      {NAV_ITEMS.map((item) => (
        <ActivityButton
          key={item.panel}
          item={item}
          isActive={activePanel === item.panel}
          onClick={() => setActivePanel(item.panel)}
        />
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSettings}
              className="relative flex h-8 w-8 items-center justify-center rounded text-base text-fg-ghost transition-all duration-150 hover:scale-110 hover:bg-border hover:text-fg"
            >
              ⚙
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">설정</TooltipContent>
        </Tooltip>

        <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-white cursor-pointer transition-all duration-150 hover:ring-2 hover:ring-accent/50">
          X
        </div>
      </div>
    </div>
  )
}

function ActivityButton({ item, isActive, onClick }: {
  item: NavItem
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded text-base transition-all duration-150',
            isActive
              ? 'text-fg hover:bg-accent-bg'
              : 'text-fg-ghost opacity-50 hover:opacity-100 hover:scale-110 hover:bg-border hover:text-fg'
          )}
        >
          {isActive && (
            <motion.div
              layoutId="activity-indicator"
              className="absolute -left-2.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 20, opacity: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            />
          )}
          {item.icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/layout/ActivityBar.tsx
git commit -m "feat(app): ActivityBar — 아이콘 레일 + Framer Motion 활성 표시선"
```

---

### Task 7: Sidebar 재설계 (Slack 채널 스타일)

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Step 1: Sidebar.tsx 전체 교체**

`xzawedOrchestrator/packages/app/src/renderer/src/components/Sidebar.tsx`:

```tsx
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { createSession } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Badge } from './ui/badge.js'
import { Separator } from './ui/separator.js'

interface SessionEntry {
  id: string
  label: string
  status: 'active' | 'paused' | 'idle'
}

// 실제 구현에서는 세션 목록을 별도 store에서 관리. 현재는 현재 세션만 표시.
function useSessions(currentSessionId: string | null): { today: SessionEntry[]; yesterday: SessionEntry[] } {
  const today: SessionEntry[] = currentSessionId
    ? [{ id: currentSessionId, label: '현재 세션', status: 'active' }]
    : []
  return { today, yesterday: [] }
}

export function Sidebar(): React.JSX.Element {
  const { settings } = useAppStore()
  const { sessionId, initSession } = useChatStore()
  const { github, mcp, plugins, setActivePanel } = useIntegrationsStore()
  const [isCreating, setIsCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [todayOpen, setTodayOpen] = useState(true)
  const { today, yesterday } = useSessions(sessionId)

  async function handleNewSession(): Promise<void> {
    if (isCreating) return
    setIsCreating(true)
    try {
      const { sessionId: newId } = await createSession(settings.serverUrl, settings.userId)
      initSession(newId)
      setActivePanel('chat')
    } catch {
      // ignore
    } finally {
      setIsCreating(false)
    }
  }

  const filteredToday = today.filter((s) =>
    s.label.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex w-[210px] flex-shrink-0 flex-col border-r border-border bg-surface overflow-hidden">

      {/* Search */}
      <div className="px-2.5 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 rounded bg-border/60 px-2.5 py-1.5 text-[11px] text-fg-ghost transition-all duration-200 focus-within:bg-border focus-within:ring-1 focus-within:ring-accent/30">
          <span className="text-[10px]">🔍</span>
          <input
            type="text"
            placeholder="세션 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-fg placeholder:text-fg-ghost outline-none text-[11px]"
          />
          <kbd className="rounded bg-surface px-1 py-0.5 text-[8px] text-fg-ghost border border-border">⌘F</kbd>
        </div>
      </div>

      {/* New Session Button */}
      <div className="px-2.5 pb-2">
        <motion.button
          onClick={handleNewSession}
          disabled={isCreating}
          className="w-full rounded bg-accent py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 flex items-center justify-center gap-1"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.1 }}
        >
          <span>＋</span>
          {isCreating ? '생성 중...' : '새 세션'}
        </motion.button>
      </div>

      <Separator />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">

        {/* Today group */}
        <div
          className="flex items-center justify-between px-3 py-1 cursor-pointer select-none"
          onClick={() => setTodayOpen((v) => !v)}
        >
          <span className="text-[9px] uppercase tracking-wide text-fg-ghost">오늘</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-accent">{filteredToday.length}</span>
            <span className={cn('text-[9px] text-fg-ghost transition-transform duration-150', todayOpen ? 'rotate-0' : '-rotate-90')}>▾</span>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {todayOpen && (
            <motion.div
              key="today-sessions"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {filteredToday.map((s, i) => (
                <SessionItem key={s.id} session={s} index={i} isActive={s.id === sessionId} />
              ))}
              {filteredToday.length === 0 && (
                <p className="px-4 py-2 text-[10px] text-fg-ghost">세션이 없습니다</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Separator />

      {/* Integration badges */}
      <div className="flex items-center gap-2 px-3 py-2">
        {github.connected && (
          <Badge variant="ok" className="cursor-pointer" onClick={() => setActivePanel('github')}>
            ● GH
          </Badge>
        )}
        {mcp.servers.length > 0 && (
          <Badge variant="active" className="cursor-pointer" onClick={() => setActivePanel('mcp')}>
            MCP {mcp.servers.length}
          </Badge>
        )}
        {plugins.length > 0 && (
          <Badge variant="muted" className="cursor-pointer" onClick={() => setActivePanel('plugins')}>
            플러그인 {plugins.length}
          </Badge>
        )}
      </div>
    </div>
  )
}

function SessionItem({ session, index, isActive }: {
  session: SessionEntry
  index: number
  isActive: boolean
}): React.JSX.Element {
  const dotColor = {
    active: 'bg-ok animate-pulse-glow-green',
    paused: 'bg-warn',
    idle:   'bg-fg-ghost',
  }[session.status]

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={cn(
        'mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors duration-100',
        'border-l-2',
        isActive
          ? 'border-accent bg-accent-bg text-fg'
          : 'border-transparent text-fg-muted hover:bg-surface-raised hover:text-fg'
      )}
    >
      <div className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', dotColor)} />
      <span className="truncate">{session.label}</span>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/Sidebar.tsx
git commit -m "feat(app): Sidebar Slack 채널 스타일 재설계 — 검색·날짜 그룹·Framer Motion 애니메이션"
```

---

### Task 8: RightPanel + StatusBar 생성

**Files:**
- Create: `src/renderer/src/components/layout/RightPanel.tsx`
- Create: `src/renderer/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: RightPanel.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/layout/RightPanel.tsx`:

```tsx
import React, { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useChatStore } from '../../store/chat.store.js'
import { cn } from '../../lib/utils.js'

const AGENT_COLORS: Record<string, string> = {
  MGR: 'text-agent-mgr',
  PLN: 'text-agent-planner',
  DEV: 'text-agent-dev',
  TST: 'text-agent-tester',
  BLD: 'text-agent-builder',
  WCH: 'text-agent-watcher',
  SCR: 'text-agent-security',
  DES: 'text-agent-designer',
}

function getLineColor(line: string): string {
  const match = line.match(/^\[([A-Z]{2,3})\]/)
  if (match) return AGENT_COLORS[match[1]] ?? 'text-fg-dim'
  return 'text-fg-ghost'
}

export function RightPanel(): React.JSX.Element {
  const { logLines, tokenCount, elapsedMs, modifiedFiles, isStreaming } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  const elapsedSec = Math.floor(elapsedMs / 1000)
  const elapsedStr = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`

  return (
    <div className="flex w-[200px] flex-shrink-0 flex-col border-l border-border bg-bg overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        {isStreaming && (
          <div className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse-glow-green" />
        )}
        <span className="text-[9px] uppercase tracking-wide text-fg-ghost">Output</span>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0 space-y-0.5">
        {logLines.length === 0 && (
          <p className="text-[9px] text-fg-ghost italic">대기 중...</p>
        )}
        {logLines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('font-mono text-[9px] leading-relaxed', getLineColor(line))}
          >
            {line}
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Stats footer */}
      <div className="border-t border-border px-3 py-2 space-y-1">
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">토큰</span>
          <span className="text-agent-dev font-mono">{tokenCount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">경과</span>
          <span className="font-mono text-fg-dim">{elapsedStr}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-fg-ghost">수정 파일</span>
          <span className="text-ok font-mono">{modifiedFiles.length}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: StatusBar.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/layout/StatusBar.tsx`:

```tsx
import React from 'react'
import { useAppStore } from '../../store/app.store.js'
import { useIntegrationsStore } from '../../store/integrations.store.js'
import { cn } from '../../lib/utils.js'

export function StatusBar(): React.JSX.Element {
  const { serverStatus } = useAppStore()
  const { github, mcp } = useIntegrationsStore()

  return (
    <div className="flex h-5 flex-shrink-0 items-center gap-3 bg-statusbar px-3 text-[10px] text-white/85">
      <span className={cn('flex items-center gap-1', serverStatus !== 'running' && 'opacity-60')}>
        <span className={cn('h-1.5 w-1.5 rounded-full', serverStatus === 'running' ? 'bg-ok' : 'bg-danger')} />
        서버 {serverStatus === 'running' ? '실행중' : serverStatus === 'stopped' ? '중지됨' : '확인중'}
      </span>
      {github.connected && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          GitHub: {github.username}
        </span>
      )}
      {mcp.servers.length > 0 && (
        <span>MCP {mcp.servers.length}개</span>
      )}
      <div className="ml-auto">xzawedPAIS v1.0</div>
    </div>
  )
}
```

- [ ] **Step 3: App.tsx에 StatusBar 추가**

`App.tsx`의 최하단 `</div>` 직전에 `<StatusBar />`를 삽입하고, import 추가:

```tsx
// App.tsx 상단 imports에 추가
import { StatusBar } from './components/layout/StatusBar.js'

// return 내부 최하단 Toaster 다음에 추가
<StatusBar />
```

- [ ] **Step 4: 빌드 확인**

```bash
cd xzawedOrchestrator/packages/app
pnpm build
```

Expected: BUILD SUCCESS (CommandPalette 스텁이 아직 없으면 오류 발생 — 다음 단계에서 처리)

- [ ] **Step 5: 빈 CommandPalette 스텁 생성 (빌드 통과용)**

`src/renderer/src/components/CommandPalette.tsx`:

```tsx
import React from 'react'

// Phase 5에서 완전 구현. 현재는 빈 컴포넌트.
export function CommandPalette(): React.JSX.Element {
  return null
}
```

- [ ] **Step 6: 빌드 재확인**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/layout/ \
        xzawedOrchestrator/packages/app/src/renderer/src/components/CommandPalette.tsx \
        xzawedOrchestrator/packages/app/src/renderer/src/App.tsx
git commit -m "feat(app): RightPanel 라이브 로그 패널 + StatusBar 추가"
```

---

### Task 9: App.css 제거 + 남은 CSS 정리

**Files:**
- Delete: `src/renderer/src/App.css`
- Create: 각 패널 컴포넌트에 Tailwind 클래스 적용

기존 CSS 클래스(`chat-panel`, `app-shell` 등)가 없어지므로, 기존 컴포넌트들의 `className`을 Tailwind로 교체한다.

- [ ] **Step 1: ChatView.tsx의 클래스 수정**

`src/renderer/src/components/ChatView.tsx` — `className` 부분만 교체:

```tsx
// 기존: <div className="chat-panel">
// 변경: <div className="flex flex-1 flex-col overflow-hidden bg-bg">

// 기존: <div className="empty-state">Start a new session from the sidebar</div>
// 변경: <div className="flex flex-1 items-center justify-center text-fg-ghost text-sm">새 세션을 시작해주세요</div>

// 기존: <div className="chat-messages">
// 변경: <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0">

// 기존: <div className="typing-indicator"><span /><span /><span /></div>
// 변경:
<div className="flex items-center gap-1 px-1">
  {[0, 1, 2].map((i) => (
    <span
      key={i}
      className="h-1.5 w-1.5 rounded-full bg-accent"
      style={{ animation: `pulse 1s ease-in-out ${i * 0.2}s infinite` }}
    />
  ))}
</div>
```

- [ ] **Step 2: App.css 삭제**

```bash
rm "xzawedOrchestrator/packages/app/src/renderer/src/App.css"
```

- [ ] **Step 3: 빌드 + 테스트**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
cd ../.. && pnpm test
```

Expected: BUILD SUCCESS, 74/74 PASS

- [ ] **Step 4: Commit**

```bash
git add -A xzawedOrchestrator/packages/app/src/renderer/src/
git commit -m "refactor(app): App.css 제거 → Tailwind CSS 완전 전환"
```

---

## Phase 3 — 채팅 핵심 컴포넌트

### Task 10: parseAgentSteps 유틸리티 + 테스트

**Files:**
- Create: `src/renderer/src/lib/parseAgentSteps.ts`
- Create: `src/renderer/src/lib/parseAgentSteps.test.ts`

- [ ] **Step 1: 테스트 먼저 작성**

`xzawedOrchestrator/packages/app/src/renderer/src/lib/parseAgentSteps.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseAgentSteps } from './parseAgentSteps.js'

describe('parseAgentSteps', () => {
  it('단일 에이전트 블록을 파싱한다', () => {
    const content = '[PLN] 계획 완료: 3단계'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(1)
    expect(steps[0].agentName).toBe('Planner')
    expect(steps[0].content).toBe('계획 완료: 3단계')
    expect(steps[0].status).toBe('done')
  })

  it('여러 에이전트 블록을 순서대로 파싱한다', () => {
    const content = '[PLN] 3단계 계획\n[DEV] auth.ts 수정 중\n파일 작성...'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(2)
    expect(steps[0].agentName).toBe('Planner')
    expect(steps[1].agentName).toBe('Developer')
    expect(steps[1].content).toBe('auth.ts 수정 중\n파일 작성...')
  })

  it('에이전트 태그 없는 콘텐츠는 단일 Assistant 스텝으로 반환한다', () => {
    const content = '일반 텍스트 응답입니다.'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(1)
    expect(steps[0].agentName).toBe('Assistant')
    expect(steps[0].content).toBe('일반 텍스트 응답입니다.')
  })

  it('빈 콘텐츠는 빈 배열을 반환한다', () => {
    expect(parseAgentSteps('')).toHaveLength(0)
  })

  it('스트리밍 중인 마지막 스텝은 active 상태다', () => {
    const content = '[PLN] 완료\n[DEV] 작업 중'
    const steps = parseAgentSteps(content, true)
    expect(steps[0].status).toBe('done')
    expect(steps[1].status).toBe('active')
  })

  it('[MGR] 태그를 Manager로 매핑한다', () => {
    const steps = parseAgentSteps('[MGR] 디스패치 완료')
    expect(steps[0].agentName).toBe('Manager')
  })
})
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

```bash
cd xzawedOrchestrator/packages/app
pnpm test src/renderer/src/lib/parseAgentSteps.test.ts
```

Expected: FAIL (파일 없음)

- [ ] **Step 3: parseAgentSteps.ts 구현**

`xzawedOrchestrator/packages/app/src/renderer/src/lib/parseAgentSteps.ts`:

```ts
export type AgentName =
  | 'Manager'
  | 'Planner'
  | 'Developer'
  | 'Designer'
  | 'Tester'
  | 'Builder'
  | 'Watcher'
  | 'Security'
  | 'Assistant'

export type StepStatus = 'done' | 'active' | 'waiting' | 'error'

export interface AgentStep {
  agentName: AgentName
  status: StepStatus
  content: string
  durationMs?: number
}

const TAG_MAP: Record<string, AgentName> = {
  MGR: 'Manager',
  PLN: 'Planner',
  DEV: 'Developer',
  DES: 'Designer',
  TST: 'Tester',
  BLD: 'Builder',
  WCH: 'Watcher',
  SCR: 'Security',
}

const AGENT_TAG_RE = /^\[([A-Z]{2,3})\]\s?/

export function parseAgentSteps(content: string, isStreaming = false): AgentStep[] {
  if (!content.trim()) return []

  const lines = content.split('\n')
  const segments: Array<{ tag: string | null; lines: string[] }> = []
  let current: { tag: string | null; lines: string[] } | null = null

  for (const line of lines) {
    const match = line.match(AGENT_TAG_RE)
    if (match) {
      if (current) segments.push(current)
      current = { tag: match[1], lines: [line.replace(AGENT_TAG_RE, '')] }
    } else {
      if (!current) current = { tag: null, lines: [] }
      current.lines.push(line)
    }
  }
  if (current) segments.push(current)

  if (segments.length === 0) return []

  // No agent tags → single Assistant step
  if (segments.length === 1 && segments[0].tag === null) {
    return [{
      agentName: 'Assistant',
      status: isStreaming ? 'active' : 'done',
      content: segments[0].lines.join('\n').trim(),
    }]
  }

  return segments
    .filter((s) => s.tag !== null || s.lines.some((l) => l.trim()))
    .map((s, i, arr) => {
      const agentName: AgentName = s.tag ? (TAG_MAP[s.tag] ?? 'Assistant') : 'Assistant'
      const isLast = i === arr.length - 1
      const status: StepStatus = isLast && isStreaming ? 'active' : 'done'
      return { agentName, status, content: s.lines.join('\n').trim() }
    })
}
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

```bash
cd xzawedOrchestrator/packages/app
pnpm test src/renderer/src/lib/parseAgentSteps.test.ts
```

Expected: 7/7 PASS

- [ ] **Step 5: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/lib/parseAgentSteps.ts \
        xzawedOrchestrator/packages/app/src/renderer/src/lib/parseAgentSteps.test.ts
git commit -m "feat(app): parseAgentSteps 유틸리티 + 테스트 7개 (TDD)"
```

---

### Task 11: UserBubble

**Files:**
- Create: `src/renderer/src/components/chat/UserBubble.tsx`

- [ ] **Step 1: UserBubble.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/chat/UserBubble.tsx`:

```tsx
import React from 'react'
import { motion } from 'framer-motion'
import type { Message } from '@xzawed/shared'

interface Props {
  message: Message
}

export function UserBubble({ message }: Props): React.JSX.Element {
  return (
    <motion.div
      className="flex justify-end"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div
        className="max-w-[60%] rounded-[10px_10px_2px_10px] bg-accent px-3.5 py-2 text-[12px] leading-relaxed text-white"
      >
        {message.content}
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/chat/UserBubble.tsx
git commit -m "feat(app): UserBubble — 사용자 메시지 말풍선 + slide 진입 애니메이션"
```

---

### Task 12: CodeBlock (Shiki 신택스 하이라이팅)

**Files:**
- Create: `src/renderer/src/lib/markdown.ts`
- Create: `src/renderer/src/components/chat/CodeBlock.tsx`

- [ ] **Step 1: markdown.ts 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/lib/markdown.ts`:

```ts
import { createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
      langs: [
        'typescript', 'javascript', 'tsx', 'jsx',
        'python', 'bash', 'json', 'yaml', 'markdown',
        'css', 'html', 'sql', 'go', 'rust',
      ],
    })
  }
  return highlighterPromise
}

export function detectLang(filename?: string): string {
  if (!filename) return 'typescript'
  const ext = filename.split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', css: 'css', html: 'html', sql: 'sql',
    go: 'go', rs: 'rust',
  }
  return map[ext] ?? 'typescript'
}
```

- [ ] **Step 2: CodeBlock.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/chat/CodeBlock.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { getHighlighter, detectLang } from '../../lib/markdown.js'

interface Props {
  code: string
  filename?: string
  lang?: string
  streaming?: boolean
}

export function CodeBlock({ code, filename, lang, streaming = false }: Props): React.JSX.Element {
  const [html, setHtml] = useState('')
  const [copied, setCopied] = useState(false)
  const language = lang ?? detectLang(filename)

  useEffect(() => {
    let cancelled = false
    getHighlighter().then((hl) => {
      if (cancelled) return
      const highlighted = hl.codeToHtml(code, { lang: language, theme: 'dark-plus' })
      setHtml(highlighted)
    }).catch(() => setHtml(`<pre><code>${code}</code></pre>`))
    return () => { cancelled = true }
  }, [code, language])

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mt-2 overflow-hidden rounded border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[9px] text-fg-ghost">{filename ?? language}</span>
        <button
          onClick={handleCopy}
          className="text-[9px] text-accent hover:text-fg transition-colors duration-150"
        >
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <div className="relative overflow-x-auto">
        {html ? (
          <div
            className="px-3 py-2 text-[10px] [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="px-3 py-2 text-[10px] text-fg-muted font-mono">{code}</pre>
        )}
        {streaming && (
          <span className="absolute bottom-2 right-3 inline-block h-3 w-0.5 bg-fg animate-blink" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/lib/markdown.ts \
        xzawedOrchestrator/packages/app/src/renderer/src/components/chat/CodeBlock.tsx
git commit -m "feat(app): CodeBlock — Shiki VSCode Dark+ 신택스 하이라이팅 + 복사 버튼"
```

---

### Task 13: AgentTimelineCard

**Files:**
- Create: `src/renderer/src/components/chat/AgentTimelineCard.tsx`

- [ ] **Step 1: AgentTimelineCard.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/chat/AgentTimelineCard.tsx`:

```tsx
import React from 'react'
import { motion } from 'framer-motion'
import type { Message } from '@xzawed/shared'
import { parseAgentSteps, type AgentStep, type AgentName } from '../../lib/parseAgentSteps.js'
import { CodeBlock } from './CodeBlock.js'
import { cn } from '../../lib/utils.js'

interface Props {
  message: Message
  streaming?: boolean
}

const AGENT_META: Record<AgentName, { icon: string; color: string; bgDone: string; bgActive: string }> = {
  Manager:   { icon: '🎯', color: 'text-agent-mgr',      bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
  Planner:   { icon: '🗺',  color: 'text-agent-planner',  bgDone: 'border-border bg-surface',       bgActive: 'border-ok bg-ok-bg' },
  Developer: { icon: '💻', color: 'text-agent-dev',      bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
  Designer:  { icon: '🎨', color: 'text-agent-designer', bgDone: 'border-border bg-surface',       bgActive: 'border-warn/50 bg-warn/10' },
  Tester:    { icon: '🧪', color: 'text-agent-tester',   bgDone: 'border-border bg-surface',       bgActive: 'border-warn/50 bg-warn/10' },
  Builder:   { icon: '⚙️', color: 'text-agent-builder',  bgDone: 'border-border bg-surface',       bgActive: 'border-agent-builder/40 bg-surface' },
  Watcher:   { icon: '👁',  color: 'text-agent-watcher',  bgDone: 'border-border bg-surface',       bgActive: 'border-agent-watcher/40 bg-surface' },
  Security:  { icon: '🔒', color: 'text-agent-security', bgDone: 'border-border bg-surface',       bgActive: 'border-danger/40 bg-danger/5' },
  Assistant: { icon: '🤖', color: 'text-fg-muted',       bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
}

const CODE_FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g

function extractCodeBlocks(content: string): Array<{ lang: string; code: string; raw: string }> {
  const blocks: Array<{ lang: string; code: string; raw: string }> = []
  let match: RegExpExecArray | null
  CODE_FENCE_RE.lastIndex = 0
  while ((match = CODE_FENCE_RE.exec(content)) !== null) {
    blocks.push({ lang: match[1] || 'typescript', code: match[2].trim(), raw: match[0] })
  }
  return blocks
}

function renderContent(content: string, streaming: boolean): React.ReactNode {
  if (!content) return null
  const blocks = extractCodeBlocks(content)
  if (blocks.length === 0) {
    return <p className="whitespace-pre-wrap text-[11px] text-fg leading-relaxed">{content}</p>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  CODE_FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = CODE_FENCE_RE.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index).trim()
    if (textBefore) {
      parts.push(<p key={`t-${i}`} className="whitespace-pre-wrap text-[11px] text-fg leading-relaxed mb-1">{textBefore}</p>)
    }
    parts.push(
      <CodeBlock key={`c-${i}`} code={blocks[i]?.code ?? ''} lang={blocks[i]?.lang} streaming={streaming && i === blocks.length - 1} />
    )
    lastIndex = match.index + match[0].length
    i++
  }
  const trailing = content.slice(lastIndex).trim()
  if (trailing) {
    parts.push(<p key="t-end" className="whitespace-pre-wrap text-[11px] text-fg leading-relaxed mt-1">{trailing}</p>)
  }
  return <>{parts}</>
}

export function AgentTimelineCard({ message, streaming = false }: Props): React.JSX.Element {
  const steps = parseAgentSteps(message.content, streaming)

  if (steps.length === 0) return <div />

  return (
    <motion.div
      className="flex flex-col gap-0"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Timeline */}
      <div className="relative pl-4">
        {/* Vertical line */}
        <div className="absolute left-1.5 top-3 bottom-3 w-px bg-gradient-to-b from-ok via-accent to-border" />

        {steps.map((step, i) => (
          <TimelineStep
            key={`${step.agentName}-${i}`}
            step={step}
            index={i}
            isLast={i === steps.length - 1}
            streaming={streaming}
          />
        ))}
      </div>
    </motion.div>
  )
}

function TimelineStep({ step, index, streaming }: {
  step: AgentStep
  index: number
  isLast: boolean
  streaming: boolean
}): React.JSX.Element {
  const meta = AGENT_META[step.agentName]
  const isActive = step.status === 'active'
  const isDone = step.status === 'done'
  const isWaiting = step.status === 'waiting'

  return (
    <motion.div
      className="relative mb-2"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.25 }}
    >
      {/* Dot */}
      <div className={cn(
        'absolute -left-4 top-2.5 h-2.5 w-2.5 rounded-full border-2',
        isDone    && 'border-ok bg-ok-bg',
        isActive  && 'border-accent bg-accent-bg animate-pulse-glow-blue',
        isWaiting && 'border-border bg-surface opacity-50',
        step.status === 'error' && 'border-danger bg-danger/10',
      )} />

      {/* Card */}
      <div className={cn(
        'rounded-md border px-3 py-2 transition-colors duration-200',
        isDone    && meta.bgDone,
        isActive  && meta.bgActive,
        isWaiting && 'border-border-dim bg-surface opacity-60',
        step.status === 'error' && 'border-danger/40 bg-danger/5',
      )}>
        {/* Header */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[11px]">{meta.icon}</span>
          <span className={cn('text-[10px] font-semibold', meta.color)}>{step.agentName}</span>
          {isDone && (
            <span className="ml-auto rounded-full bg-ok-bg px-1.5 py-0.5 text-[8px] text-ok border border-ok/20">
              ✓ 완료
            </span>
          )}
          {isActive && (
            <span className="ml-auto rounded-full bg-accent-bg px-1.5 py-0.5 text-[8px] text-accent border border-accent/30 animate-pulse-glow-blue">
              ⚡ 진행중
            </span>
          )}
          {isWaiting && (
            <span className="ml-auto text-[8px] text-fg-ghost">대기중</span>
          )}
        </div>

        {/* Content */}
        {step.content && (
          <div>
            {renderContent(step.content, isActive && streaming)}
            {isActive && streaming && !step.content.includes('```') && (
              <span className="inline-block h-3 w-0.5 bg-fg animate-blink ml-0.5 align-middle" />
            )}
          </div>
        )}
        {isWaiting && !step.content && (
          <p className="text-[10px] text-fg-ghost">이전 에이전트 완료 후 시작됩니다.</p>
        )}
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/chat/AgentTimelineCard.tsx
git commit -m "feat(app): AgentTimelineCard — 타임라인 스텝 카드 + stagger 애니메이션 + 코드 블록 인라인 렌더링"
```

---

### Task 14: PipelineStrip

**Files:**
- Create: `src/renderer/src/components/chat/PipelineStrip.tsx`

- [ ] **Step 1: PipelineStrip.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/chat/PipelineStrip.tsx`:

```tsx
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AgentStep } from '../../lib/parseAgentSteps.js'
import { cn } from '../../lib/utils.js'

interface Props {
  steps: AgentStep[]
}

export function PipelineStrip({ steps }: Props): React.JSX.Element {
  if (steps.length === 0) return <div />

  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-4 py-1.5 overflow-x-auto">
      <span className="mr-1 flex-shrink-0 text-[9px] text-fg-ghost">파이프라인</span>
      {steps.map((step, i) => (
        <React.Fragment key={`${step.agentName}-${i}`}>
          {i > 0 && (
            <div className={cn(
              'h-px w-3 flex-shrink-0',
              steps[i - 1].status === 'done' ? 'bg-ok' : 'bg-border'
            )} />
          )}
          <AnimatePresence mode="wait">
            <motion.div
              layout
              key={step.status}
              className={cn(
                'flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] border transition-colors duration-300',
                step.status === 'done'  && 'bg-ok-bg text-ok border-ok/30',
                step.status === 'active' && 'bg-accent-bg text-accent border-accent/40 animate-pulse-glow-blue',
                step.status === 'waiting' && 'bg-surface text-fg-ghost border-border',
                step.status === 'error'  && 'bg-danger/10 text-danger border-danger/30',
              )}
            >
              {step.status === 'done'   && '✓ '}
              {step.status === 'active' && '⚡ '}
              {step.status === 'waiting' && '○ '}
              {step.agentName}
            </motion.div>
          </AnimatePresence>
        </React.Fragment>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/chat/PipelineStrip.tsx
git commit -m "feat(app): PipelineStrip — 에이전트 파이프라인 진행 시각화"
```

---

### Task 15: ChatView 리팩터 — 새 컴포넌트 통합

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx`
- Delete: `src/renderer/src/components/MessageBubble.tsx`

- [ ] **Step 1: ChatView.tsx 전체 교체**

`xzawedOrchestrator/packages/app/src/renderer/src/components/ChatView.tsx`:

```tsx
import React, { useEffect, useRef } from 'react'
import type { Message } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { UserBubble } from './chat/UserBubble.js'
import { AgentTimelineCard } from './chat/AgentTimelineCard.js'
import { PipelineStrip } from './chat/PipelineStrip.js'
import { MessageInput } from './MessageInput.js'
import { ScrollArea } from './ui/scroll-area.js'
import { parseAgentSteps } from '../lib/parseAgentSteps.js'
import { postMessage, SessionWsClient } from '../lib/api.js'

export function ChatView(): React.JSX.Element {
  const {
    sessionId, messages, streamingContent, streamingMsgId, isStreaming, isPending,
  } = useChatStore()
  const {
    initSession: _init, addMessage, setPending, startStream,
    appendChunk, finalizeStream, addLogLine,
  } = useChatStore.getState()
  const { settings } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    if (!sessionId) return
    const client = new SessionWsClient()
    const teardown = client.connect(settings.serverUrl, sessionId, (msg) => {
      if (msg.type === 'chunk') {
        const state = useChatStore.getState()
        if (state.streamingMsgId !== msg.messageId) startStream(msg.messageId)
        appendChunk(msg.content)
        // 로그 라인 추출 (에이전트 태그가 있는 줄)
        const lines = msg.content.split('\n').filter((l) => l.match(/^\[[A-Z]{2,3}\]/))
        lines.forEach((l) => addLogLine(l.trim()))
      } else if (msg.type === 'done') {
        finalizeStream(msg.messageId)
      } else if (msg.type === 'error') {
        setPending(false)
        addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${msg.content}`, timestamp: Date.now() })
      }
    }, () => { useChatStore.getState().cancelStream() })
    return teardown
  }, [sessionId, settings.serverUrl])

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return
    addMessage({ id: crypto.randomUUID(), sessionId, role: 'user', content, timestamp: Date.now() })
    try {
      await postMessage(settings.serverUrl, sessionId, content)
      setPending(true)
    } catch (err) {
      addMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', content: `[Error] ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now() })
    }
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-bg text-fg-ghost">
        <div className="mb-2 text-4xl">💬</div>
        <p className="text-sm text-fg-muted">새 세션을 시작해주세요</p>
        <p className="mt-1 text-[10px] text-fg-ghost">사이드바의 <strong className="text-fg-dim">+ 새 세션</strong> 버튼을 클릭하거나 <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[9px]">⌘K</kbd>를 누르세요</p>
      </div>
    )
  }

  // 현재 스트리밍 중인 콘텐츠로 파이프라인 스텝 계산
  const streamingSteps = isStreaming && streamingContent
    ? parseAgentSteps(streamingContent, true)
    : messages.length > 0
      ? parseAgentSteps(messages[messages.length - 1]?.content ?? '', false)
      : []

  const streamingMessage: Message | null =
    isStreaming && streamingMsgId
      ? { id: streamingMsgId, sessionId, role: 'assistant', content: streamingContent, timestamp: Date.now() }
      : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">

      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-ok" />
        <span className="text-[13px] font-semibold text-fg">현재 세션</span>
        <div className="ml-auto">
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] text-fg-ghost">⌘K</kbd>
        </div>
      </div>

      {/* Pipeline strip */}
      <PipelineStrip steps={streamingSteps} />

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserBubble key={msg.id} message={msg} />
            ) : (
              <AgentTimelineCard key={msg.id} message={msg} streaming={false} />
            )
          )}
          {streamingMessage && (
            <AgentTimelineCard key="streaming" message={streamingMessage} streaming />
          )}
          {isPending && !isStreaming && (
            <div className="flex items-center gap-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-accent"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={isStreaming || isPending} />
    </div>
  )
}
```

- [ ] **Step 2: MessageBubble.tsx 삭제**

```bash
rm "xzawedOrchestrator/packages/app/src/renderer/src/components/MessageBubble.tsx"
```

- [ ] **Step 3: 빌드 + 테스트**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
cd ../.. && pnpm test
```

Expected: BUILD SUCCESS, 74/74 PASS (parseAgentSteps 7개 포함)

- [ ] **Step 4: Commit**

```bash
git add -A xzawedOrchestrator/packages/app/src/renderer/src/components/
git commit -m "feat(app): ChatView 리팩터 — AgentTimelineCard·PipelineStrip·UserBubble 통합"
```

---

## Phase 4 — 애니메이션 강화

### Task 16: MessageInput 재설계 + focus 글로우

**Files:**
- Modify: `src/renderer/src/components/MessageInput.tsx`

- [ ] **Step 1: MessageInput.tsx 전체 교체**

`xzawedOrchestrator/packages/app/src/renderer/src/components/MessageInput.tsx`:

```tsx
import React, { useState, useRef, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'

interface Props {
  onSend: (content: string) => void
  disabled: boolean
}

export function MessageInput({ onSend, disabled }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend(): void {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleInput(): void {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="border-t border-border bg-bg px-3 py-2.5">
      <motion.div
        className="flex items-end gap-2 rounded-lg border bg-surface px-3 py-2 transition-colors duration-200"
        animate={{
          borderColor: focused ? 'rgba(0, 120, 212, 0.6)' : 'var(--color-border)',
          boxShadow: focused ? '0 0 0 1px rgba(0, 120, 212, 0.2)' : 'none',
        }}
        transition={{ duration: 0.15 }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="메시지를 입력하세요..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-[12px] text-fg placeholder:text-fg-ghost outline-none disabled:opacity-50 max-h-[120px] leading-relaxed"
          style={{ minHeight: '20px' }}
        />
        <div className="flex items-center gap-2 flex-shrink-0 self-end pb-0.5">
          <span className="hidden sm:block text-[9px] text-fg-ghost">
            {disabled ? '' : 'Enter 전송 · Shift+Enter 줄바꿈'}
          </span>
          <motion.button
            onClick={handleSend}
            disabled={!canSend}
            className="h-6 w-6 rounded flex items-center justify-center text-[11px] bg-accent text-white disabled:opacity-30 transition-colors"
            whileHover={canSend ? { scale: 1.05 } : {}}
            whileTap={canSend ? { scale: 0.95 } : {}}
          >
            ↑
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/MessageInput.tsx
git commit -m "feat(app): MessageInput 재설계 — focus glow 애니메이션 + 전송 버튼"
```

---

## Phase 5 — 기능 강화

### Task 17: MarkdownContent 컴포넌트 (react-markdown)

**Files:**
- Create: `src/renderer/src/components/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/components/chat/AgentTimelineCard.tsx` (renderContent 교체)

- [ ] **Step 1: MarkdownContent.tsx 생성**

`xzawedOrchestrator/packages/app/src/renderer/src/components/chat/MarkdownContent.tsx`:

```tsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock.js'

interface Props {
  content: string
  streaming?: boolean
}

export function MarkdownContent({ content, streaming = false }: Props): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="prose-sm text-[11px] leading-relaxed text-fg [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:mb-0.5 [&_strong]:text-fg [&_em]:text-fg-muted [&_a]:text-accent [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-fg-dim"
      components={{
        code({ node: _node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '')
          const inline = !match
          if (inline) {
            return (
              <code
                className="rounded bg-code px-1 py-0.5 font-mono text-[10px] text-warn"
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <CodeBlock
              code={String(children).replace(/\n$/, '')}
              lang={match[1]}
              streaming={streaming}
            />
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
```

- [ ] **Step 2: AgentTimelineCard의 renderContent를 MarkdownContent로 교체**

`AgentTimelineCard.tsx`에서 `renderContent` 함수와 `CODE_FENCE_RE` 관련 코드를 제거하고 import 추가:

```tsx
// 상단 import에 추가
import { MarkdownContent } from './MarkdownContent.js'

// renderContent 함수 전체를 삭제하고, TimelineStep의 content 렌더링 부분 교체:
// 기존:
//   {renderContent(step.content, isActive && streaming)}
// 변경:
{step.content && (
  <MarkdownContent content={step.content} streaming={isActive && streaming} />
)}

// CODE_FENCE_RE 상수 및 extractCodeBlocks 함수도 삭제
```

- [ ] **Step 3: 빌드 확인**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/chat/MarkdownContent.tsx \
        xzawedOrchestrator/packages/app/src/renderer/src/components/chat/AgentTimelineCard.tsx
git commit -m "feat(app): MarkdownContent — react-markdown + remark-gfm GFM 지원"
```

---

### Task 18: CommandPalette (⌘K)

**Files:**
- Modify: `src/renderer/src/components/CommandPalette.tsx`

- [ ] **Step 1: CommandPalette.tsx 완전 구현**

`xzawedOrchestrator/packages/app/src/renderer/src/components/CommandPalette.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/app.store.js'
import { useIntegrationsStore } from '../store/integrations.store.js'
import { useChatStore } from '../store/chat.store.js'
import { createSession } from '../lib/api.js'
import {
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from './ui/command.js'

export function CommandPalette(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { settings, toggleSettings } = useAppStore()
  const { setActivePanel } = useIntegrationsStore()
  const { initSession } = useChatStore()

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function newSession(): Promise<void> {
    setOpen(false)
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
      setActivePanel('chat')
    } catch { /* ignore */ }
  }

  function navigate(panel: 'chat' | 'github' | 'mcp' | 'plugins'): void {
    setOpen(false)
    setActivePanel(panel)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <motion.div
            className="fixed left-1/2 top-[30%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Command>
              <CommandInput placeholder="명령어 검색..." />
              <CommandList>
                <CommandEmpty>결과 없음</CommandEmpty>
                <CommandGroup heading="세션">
                  <CommandItem onSelect={newSession}>
                    <span>＋</span> 새 세션 시작
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="이동">
                  <CommandItem onSelect={() => navigate('chat')}>
                    <span>💬</span> 채팅으로 이동
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('github')}>
                    <span>🐙</span> GitHub 패널
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('mcp')}>
                    <span>🔌</span> MCP 서버 패널
                  </CommandItem>
                  <CommandItem onSelect={() => navigate('plugins')}>
                    <span>🧩</span> 플러그인 패널
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="기타">
                  <CommandItem onSelect={() => { setOpen(false); toggleSettings() }}>
                    <span>⚙</span> 설정 열기
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/CommandPalette.tsx
git commit -m "feat(app): ⌘K 명령어 팔레트 — Spotlight 스타일, spring 애니메이션"
```

---

### Task 18: SettingsModal → shadcn Dialog

**Files:**
- Modify: `src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: SettingsModal.tsx 전체 교체**

`xzawedOrchestrator/packages/app/src/renderer/src/components/SettingsModal.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/app.store.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from './ui/dialog.js'
import { Button } from './ui/button.js'

export function SettingsModal(): React.JSX.Element {
  const { settings, showSettings, toggleSettings, updateSettings } = useAppStore()
  const [localUrl, setLocalUrl] = useState(settings.serverUrl)
  const [localMode, setLocalMode] = useState(settings.mode)
  const [localUserId, setLocalUserId] = useState(settings.userId)

  useEffect(() => {
    if (showSettings) {
      setLocalUrl(settings.serverUrl)
      setLocalMode(settings.mode)
      setLocalUserId(settings.userId)
    }
  }, [showSettings, settings])

  function handleSave(): void {
    const updated = { serverUrl: localUrl, mode: localMode, userId: localUserId }
    updateSettings(updated)
    window.electronAPI?.setSettings(updated).catch(() => {})
    toggleSettings()
  }

  const labelClass = 'block text-[10px] text-fg-ghost mb-1'
  const inputClass = 'w-full rounded border border-border bg-code px-2.5 py-1.5 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent/60 transition-colors'

  return (
    <Dialog open={showSettings} onOpenChange={toggleSettings}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>서버 URL</label>
            <input
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              className={inputClass}
              placeholder="http://localhost:3000"
            />
          </div>

          <div>
            <label className={labelClass}>모드</label>
            <select
              value={localMode}
              onChange={(e) => setLocalMode(e.target.value as 'local' | 'remote')}
              className={inputClass}
            >
              <option value="local">Local</option>
              <option value="remote">Remote</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>사용자 ID</label>
            <input
              type="text"
              value={localUserId}
              onChange={(e) => setLocalUserId(e.target.value)}
              className={inputClass}
              placeholder="user-id"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md">취소</Button>
          </DialogClose>
          <Button variant="default" size="md" onClick={handleSave}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/SettingsModal.tsx
git commit -m "feat(app): SettingsModal → shadcn Dialog — spring 진입 애니메이션"
```

---

## Phase 6 — 나머지 패널 리스타일

### Task 19: GitHubPanel 리스타일

**Files:**
- Modify: `src/renderer/src/components/GitHubPanel.tsx`

- [ ] **Step 1: 기존 GitHubPanel.tsx 읽기 + Tailwind로 className 교체**

기존 `GitHubPanel.tsx`의 `.integration-panel`, `.panel-btn--*` 등 CSS 클래스를 Tailwind로 교체. 구조·로직은 유지.

패널 래퍼:
```tsx
<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg">
  <h2 className="text-[13px] font-semibold text-fg">GitHub 연동</h2>
  {/* 기존 내용 유지 */}
</div>
```

버튼 교체:
```tsx
// 기존: className="panel-btn panel-btn--primary"
// 변경: <Button variant="default">...</Button>

// 기존: className="panel-btn panel-btn--danger"
// 변경: <Button variant="danger">...</Button>
```

- [ ] **Step 2: 빌드 + 테스트**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
cd ../.. && pnpm test
```

Expected: BUILD SUCCESS, 74/74+ PASS

- [ ] **Step 3: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/GitHubPanel.tsx
git commit -m "refactor(app): GitHubPanel Tailwind 리스타일"
```

---

### Task 20: DynamicPanel 리스타일

**Files:**
- Modify: `src/renderer/src/components/DynamicPanel.tsx`

- [ ] **Step 1: DynamicPanel.tsx className 교체**

기존 `.dynamic-panel`, `.form-panel` 등 CSS 클래스를 Tailwind로 교체. 비즈니스 로직(UISpec 기반 폼 렌더링)은 변경 없이 유지.

패널 래퍼:
```tsx
<div className="flex w-[280px] flex-shrink-0 flex-col border-l border-border bg-surface overflow-hidden">
  <div className="border-b border-border px-4 py-2 text-[13px] font-semibold text-fg">
    {spec.title ?? '컨텍스트'}
  </div>
  <div className="flex-1 overflow-y-auto p-4">
    {/* 기존 폼 렌더링 로직 유지 */}
  </div>
</div>
```

폼 input 클래스:
```tsx
// 기존 input className을 교체
"w-full rounded border border-border bg-code px-2.5 py-1.5 text-[11px] text-fg outline-none focus:border-accent/60 transition-colors"
```

- [ ] **Step 2: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/DynamicPanel.tsx
git commit -m "refactor(app): DynamicPanel Tailwind 리스타일"
```

---

### Task 21: McpPanel + PluginPanel 리스타일

**Files:**
- Modify: `src/renderer/src/components/McpPanel.tsx`
- Modify: `src/renderer/src/components/PluginPanel.tsx`

- [ ] **Step 1: McpPanel.tsx className 교체**

GitHubPanel과 동일한 패턴. 패널 래퍼를 `flex flex-1 flex-col gap-4 overflow-y-auto p-5 bg-bg`로, 버튼은 `<Button>` 컴포넌트로 교체.

- [ ] **Step 2: PluginPanel.tsx className 교체**

동일 패턴. `.badge--*` 클래스는 `<Badge variant="...">` 컴포넌트로 교체:
```tsx
// 기존: <span className="badge badge--claude-code">claude-code</span>
// 변경: <Badge variant="active">claude-code</Badge>

// 기존: <span className="badge badge--active">active</span>
// 변경: <Badge variant="ok">active</Badge>
```

- [ ] **Step 3: 빌드 + 최종 테스트**

```bash
cd xzawedOrchestrator/packages/app && pnpm build
cd ../.. && pnpm test
```

Expected: BUILD SUCCESS, 모든 테스트 PASS

- [ ] **Step 4: Commit**

```bash
git add xzawedOrchestrator/packages/app/src/renderer/src/components/McpPanel.tsx \
        xzawedOrchestrator/packages/app/src/renderer/src/components/PluginPanel.tsx
git commit -m "refactor(app): McpPanel·PluginPanel Tailwind 리스타일 + Badge 컴포넌트 적용"
```

---

## 최종 확인

- [ ] **전체 빌드**

```bash
cd xzawedOrchestrator && pnpm build
```

Expected: BUILD SUCCESS

- [ ] **전체 테스트 (parseAgentSteps 7개 포함)**

```bash
cd xzawedOrchestrator && pnpm test
```

Expected: 81/81+ PASS (기존 74개 + 신규 7개)

- [ ] **앱 실행 확인**

```bash
cd xzawedOrchestrator/packages/app && pnpm dev
```

확인 항목:
1. 4패널 레이아웃 정상 표시
2. ActivityBar 탭 전환 시 표시선 애니메이션
3. ⌘K (Ctrl+K) 팔레트 열림/닫힘
4. 새 세션 생성 후 채팅 입력 가능
5. 메시지 전송 시 UserBubble 슬라이드 진입
6. 스트리밍 중 타임라인 카드 순차 등장
7. RightPanel 로그 라인 slide-up

- [ ] **최종 Commit**

```bash
git add -A xzawedOrchestrator/
git commit -m "feat(app): xzawedPAIS UI/UX 전면 리디자인 완료 — VSCode Dark+ 4패널 + Framer Motion 애니메이션"
```
