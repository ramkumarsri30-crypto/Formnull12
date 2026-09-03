"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/formnull/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/auth-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  WorkspaceProvider,
  useWorkspaceCtx,
} from "@/features/workspace/workspace-context";
import {
  LayoutDashboard,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Plus,
  Check,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GeometricCircle,
  GeometricSquare,
} from "@/components/memphis/memphis-decorations";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/forms", label: "Forms", icon: FileText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/**
 * Dashboard layout — sidebar + header + main content.
 *
 * Responsive behavior:
 *   - Desktop (lg+): persistent left sidebar (260px)
 *   - Tablet/mobile: hidden sidebar, hamburger opens a drawer
 *
 * The WorkspaceProvider wraps ALL children so every page shares one
 * active-workspace state (loaded from and persisted to Supabase).
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </WorkspaceProvider>
  );
}

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out");
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* =============================================================== */}
      {/* Desktop sidebar (lg+)                                            */}
      {/* =============================================================== */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r-2 border-foreground/10 bg-sidebar lg:flex"
        aria-label="Primary navigation"
      >
        <SidebarContent
          pathname={pathname}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* =============================================================== */}
      {/* Mobile drawer                                                    */}
      {/* =============================================================== */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r-2 border-foreground/10 bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
              <Logo />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarContent
              pathname={pathname}
              onSignOut={handleSignOut}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* =============================================================== */}
      {/* Main content                                                     */}
      {/* =============================================================== */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b-2 border-foreground/10 bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:h-16">
          {/* Hamburger (mobile only) */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex-1">
            <h2 className="font-display text-sm font-bold tracking-tight sm:text-base">
              {getPageTitle(pathname)}
            </h2>
          </div>

          {/* Quick action */}
          <Button asChild variant="memphis-coral" size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard/forms/new">
              <Plus className="h-4 w-4" />
              New form
            </Link>
          </Button>
          <Button asChild variant="memphis-coral" size="icon-sm" className="sm:hidden" aria-label="New form">
            <Link href="/dashboard/forms/new">
              <Plus className="h-4 w-4" />
            </Link>
          </Button>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function getPageTitle(pathname: string): string {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "Overview";
  if (pathname.startsWith("/dashboard/forms/new")) return "New form";
  if (pathname.startsWith("/dashboard/forms")) return "Forms";
  if (pathname.startsWith("/dashboard/settings")) return "Settings";
  if (pathname.startsWith("/dashboard/account")) return "Account";
  return "Dashboard";
}

/* ------------------------------------------------------------------ */
/* Sidebar content — with the REAL workspace selector                  */
/* ------------------------------------------------------------------ */

function SidebarContent({
  pathname,
  onSignOut,
  onNavigate,
}: {
  pathname: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    currentRole,
    memberships,
    loading,
    setWorkspace,
    createWorkspace,
    switching,
  } = useWorkspaceCtx();
  const [createOpen, setCreateOpen] = useState(false);
  // Mobile (<768px): the workspace-selector dropdown must open BELOW the
  // trigger (side="bottom"). With side="right" the w-60 menu renders beside
  // the drawer's full-width trigger and overflows narrow viewports
  // (right edge ≈ 518px on a 375px screen), putting every menu item outside
  // the viewport. Desktop (≥768px) keeps the established side="right"
  // pop-out-over-content positioning unchanged.
  const isMobile = useIsMobile();

  const userEmail = user?.email ?? "";
  const workspaceName = currentWorkspace?.name ?? (loading ? "Loading…" : "No workspace");

  function workspaceRole(wsId: string) {
    return memberships.find((m) => m.workspace_id === wsId)?.role ?? null;
  }

  return (
    <>
      {/* Logo (desktop only — mobile drawer has its own) */}
      <div className="hidden border-b border-foreground/10 px-4 py-4 lg:block">
        <Logo />
      </div>

      {/* Workspace selector — REAL: lists the user's workspaces from
          Supabase, switches the active workspace, persists the selection. */}
      <div className="px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="group flex w-full items-center gap-3 rounded-lg border-2 border-foreground/10 bg-background p-2.5 text-left transition-colors hover:border-foreground/20 disabled:opacity-60"
              aria-label="Switch workspace"
              disabled={switching}
            >
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--memphis-coral)] text-white">
                <span className="font-display text-sm font-bold">
                  {(currentWorkspace?.name ?? "W").charAt(0).toUpperCase()}
                </span>
                <GeometricSquare
                  color="mint"
                  size={8}
                  rotate={12}
                  className="-bottom-1 -right-1 opacity-90"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">
                  Workspace{currentRole ? ` · ${currentRole}` : ""}
                </p>
                <p className="truncate text-sm font-semibold">{workspaceName}</p>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            className="w-60 max-w-[calc(100vw-2rem)]"
          >
            <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => void setWorkspace(ws.id)}
                disabled={switching}
                className="gap-2"
                aria-current={ws.id === currentWorkspaceId ? "true" : undefined}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    ws.id === currentWorkspaceId ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{ws.name}</span>
                  <span className="block text-xs capitalize text-muted-foreground">
                    {workspaceRole(ws.id)} · {ws.plan}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            {workspaces.length === 0 && !loading && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No workspaces yet — create one below.
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setCreateOpen(true)}
              disabled={switching}
              className="gap-2"
            >
              <Building2 className="h-4 w-4" />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Dashboard">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            pathname === `${item.href}/` ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-accent/10 hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div className="border-t border-foreground/10 p-3">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <span className="font-display text-sm font-bold">
              {(userEmail?.[0] ?? "?").toUpperCase()}
            </span>
            <GeometricCircle
              color="mint"
              size={10}
              className="-bottom-0.5 -right-0.5"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {userEmail.split("@")[0] || "User"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="mt-1 w-full justify-start text-foreground/70 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      {/* Create workspace dialog */}
      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createWorkspace}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Create workspace dialog                                             */
/* ------------------------------------------------------------------ */

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, description?: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    const ws = await onCreate(name, description);
    setCreating(false);
    if (ws) {
      setName("");
      setDescription("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            A new workspace gets its own forms and submissions. You will be its
            owner.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ws-create-name">Workspace name</Label>
            <Input
              id="ws-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              disabled={creating}
              aria-required="true"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-create-desc">Description (optional)</Label>
            <Textarea
              id="ws-create-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={creating}
              placeholder="What is this workspace for?"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="memphis-coral"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full sm:w-auto"
          >
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
