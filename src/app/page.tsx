"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  KeyRound,
  ListVideo,
  Sparkles,
  Wand2,
  Plug,
  Plus,
  Trash2,
  PowerOff,
  Power,
  RefreshCw,
  Copy,
  Check,
  Loader2,
  ImageIcon,
  Film,
  Merge,
  ExternalLink,
  AlertCircle,
  Clock,
  Server,
  Database,
  ShieldCheck,
  LogOut,
  Lock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  type ApiKeyView,
  type HealthState,
  type TaskView,
  type TaskType,
  type ProviderName,
  type KeyStatus,
} from "@/lib/api-client";

/* ----------------------------- Helpers ---------------------------------- */

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  exhausted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  disabled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  pending: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  processing: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const STATUS_LABEL_AR: Record<string, string> = {
  active: "نشط",
  exhausted: "الرصيد منتهٍ",
  disabled: "معطّل",
  pending: "بالانتظار",
  processing: "قيد التنفيذ",
  completed: "مكتمل",
  failed: "فشل",
};

const TYPE_LABEL_AR: Record<string, string> = {
  image: "صورة",
  video: "فيديو",
  merge: "دمج",
};

const PLATFORM_LABEL_AR: Record<string, string> = {
  all: "الكل",
  instagram: "إنستغرام",
  tiktok: "تيك توك",
  youtube: "يوتيوب",
  facebook: "فيسبوك",
  twitter: "إكس / تويتر",
  linkedin: "لينكدإن",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
    return new Intl.DateTimeFormat("ar", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return s;
  }
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);
  return { copied, copy };
}

/* --------------------------- Auth Button -------------------------------- */

function AuthButton() {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    api
      .health()
      .then((h) => setAuthEnabled(!!h.auth))
      .catch(() => {});
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  if (!authEnabled) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={logout}
      disabled={loggingOut}
      className="gap-1.5 text-muted-foreground hover:text-foreground"
    >
      {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      <span className="hidden sm:inline">خروج</span>
    </Button>
  );
}

/* ----------------------------- Header ----------------------------------- */

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-violet-500 text-white shadow-lg shadow-violet-500/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">مولّد الوسائط الذكي</h1>
            <p className="text-xs text-muted-foreground">MCP Media Generator & Social Automation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-300">
              <ShieldCheck className="h-3 w-3" />
              MCP v1
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Database className="h-3 w-3" />
              Turso
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Server className="h-3 w-3" />
              kie.ai
            </Badge>
          </div>
          <AuthButton />
        </div>
      </div>
    </header>
  );
}

/* --------------------------- Health Card --------------------------------- */

function HealthCard() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const h = await api.health();
      setHealth(h);
    } catch (e) {
      setHealth({
        ok: false,
        database: "unreachable",
        merger: false,
        keys: 0,
        auth: false,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const tursoOk = health?.database === "turso-connected";

  return (
    <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-card to-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-base">حالة النظام</CardTitle>
          <CardDescription className="text-xs">
            آخر تحديث: {health ? fmtDate(health.timestamp) : "—"}
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatusTile
          title="قاعدة Turso"
          value={tursoOk ? "متصل" : "غير متصل"}
          ok={tursoOk}
          icon={<Database className="h-4 w-4" />}
        />
        <StatusTile
          title="خدمة الدمج"
          value={health?.merger ? "متاحة" : "غير متاحة"}
          ok={!!health?.merger}
          icon={<Merge className="h-4 w-4" />}
        />
        <StatusTile
          title="مفاتيح API"
          value={String(health?.keys ?? 0)}
          ok={(health?.keys ?? 0) > 0}
          icon={<KeyRound className="h-4 w-4" />}
        />
        <StatusTile
          title="الحماية"
          value={health?.auth ? "مفعّلة" : "معطّلة"}
          ok={!!health?.auth}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatusTile
          title="النظام"
          value={health?.ok ? "يعمل" : "خطأ"}
          ok={!!health?.ok}
          icon={<Activity className="h-4 w-4" />}
        />
      </CardContent>
    </Card>
  );
}

function StatusTile({
  title,
  value,
  ok,
  icon,
}: {
  title: string;
  value: string;
  ok: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-rose-500/30 bg-rose-500/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className={ok ? "text-emerald-300" : "text-rose-300"}>{icon}</span>
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

/* ------------------------- API Keys Manager ----------------------------- */

function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderName>("kie");
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listKeys();
      setKeys(r.keys);
    } catch (e) {
      toast({
        title: "تعذّر تحميل المفاتيح",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit() {
    if (!newKey.trim()) {
      toast({ title: "أدخل مفتاح API", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.addKey(newProvider, newKey.trim(), newLabel.trim());
      toast({ title: "تمت إضافة المفتاح بنجاح" });
      setNewKey("");
      setNewLabel("");
      setOpen(false);
      await refresh();
    } catch (e) {
      toast({
        title: "فشل إضافة المفتاح",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(id: string, status: KeyStatus) {
    try {
      await api.updateKey(id, status);
      await refresh();
      toast({ title: `تم تحديث الحالة إلى: ${STATUS_LABEL_AR[status]}` });
    } catch (e) {
      toast({
        title: "فشل تحديث الحالة",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  async function remove(id: string) {
    if (!confirm("هل تريد حذف هذا المفتاح نهائيًا؟")) return;
    try {
      await api.deleteKey(id);
      await refresh();
      toast({ title: "تم حذف المفتاح" });
    } catch (e) {
      toast({
        title: "فشل الحذف",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            إدارة مفاتيح API
          </CardTitle>
          <CardDescription className="text-xs">
            المفاتيح تُجرّب بالترتيب الزمني للإضافة. في حال انتهاء الرصيد يُبدّل النظام تلقائيًا.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              إضافة مفتاح
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة مفتاح API جديد</DialogTitle>
              <DialogDescription>
                أدخل مفتاح المزوّد. سيُستخدم تلقائيًا ضمن مبدّل المفاتيح عند الحاجة.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>المزوّد</Label>
                <Select value={newProvider} onValueChange={(v) => setNewProvider(v as ProviderName)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kie">kie.ai</SelectItem>
                    <SelectItem value="cometapi">CometAPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>مفتاح API</Label>
                <Input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="أدخل المفتاح هنا"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>تسمية اختيارية</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="مثال: المفتاح الأساسي"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                حفظ المفتاح
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-amber-400" />
            <p className="text-sm">لا توجد مفاتيح. أضف مفتاحًا للبدء.</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المزوّد</TableHead>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>التسمية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الاستخدام</TableHead>
                  <TableHead>آخر استخدام</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {k.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {k.masked}
                    </TableCell>
                    <TableCell className="text-xs">{k.label || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[k.status]}`}>
                        {STATUS_LABEL_AR[k.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="text-emerald-300">{k.success_count}</span>
                      {" / "}
                      <span className="text-muted-foreground">{k.usage_count}</span>
                      {k.fail_count > 0 && (
                        <span className="text-rose-300"> ({k.fail_count} فشل)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(k.last_used_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {k.status !== "active" ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => changeStatus(k.id, "active")}>
                                  <Power className="h-3.5 w-3.5 text-emerald-400" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>تفعيل</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => changeStatus(k.id, "disabled")}>
                                  <PowerOff className="h-3.5 w-3.5 text-amber-400" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>تعطيل</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(k.id)}>
                                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>حذف</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------- Tasks Monitor ------------------------------ */

function TasksMonitor() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskType | "all">("all");
  const [selected, setSelected] = useState<TaskView | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listTasks(filter === "all" ? undefined : filter, 100);
      setTasks(r.tasks);
    } catch (e) {
      toast({
        title: "تعذّر تحميل المهام",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  // Poll the selected task more frequently to advance its progress
  useEffect(() => {
    if (!selected) return;
    let stop = false;
    const poll = async () => {
      while (!stop) {
        try {
          const t = await api.getTask(selected.id);
          if (!stop) {
            setSelected(t);
            setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          }
          if (t.status === "completed" || t.status === "failed") break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [selected?.id]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListVideo className="h-4 w-4 text-violet-400" />
            مراقب المهام المباشرة
          </CardTitle>
          <CardDescription className="text-xs">
            يتم تحديث الحالة كل بضع ثوانٍ. اضغط على مهمة لتفاصيل أكثر.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as TaskType | "all")}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="image">صور</SelectItem>
              <SelectItem value="video">فيديو</SelectItem>
              <SelectItem value="merge">دمج</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && tasks.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Clock className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm">لا توجد مهام بعد. أنشئ واحدة من استوديو التوليد.</p>
          </div>
        ) : (
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                className={`w-full rounded-lg border p-3 text-right transition-colors hover:bg-accent/40 ${
                  selected?.id === t.id ? "border-violet-500/40 bg-violet-500/5" : "border-border/60"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {t.type === "image" && <ImageIcon className="h-3.5 w-3.5 text-sky-400" />}
                    {t.type === "video" && <Film className="h-3.5 w-3.5 text-rose-400" />}
                    {t.type === "merge" && <Merge className="h-3.5 w-3.5 text-amber-400" />}
                    <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status]}`}>
                      {STATUS_LABEL_AR[t.status]}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {TYPE_LABEL_AR[t.type]}
                    </Badge>
                    {t.social_platform && t.social_platform !== "all" && (
                      <Badge variant="outline" className="text-xs">
                        {PLATFORM_LABEL_AR[t.social_platform] || t.social_platform}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{fmtDate(t.created_at)}</span>
                </div>
                <p className="mb-2 line-clamp-1 text-sm text-muted-foreground" dir="auto">
                  {t.prompt || t.model}
                </p>
                <div className="flex items-center gap-2">
                  <Progress value={t.progress} className="h-1.5 flex-1" />
                  <span className="text-xs tabular-nums text-muted-foreground">{t.progress}%</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
      {selected && (
        <TaskDetailDrawer task={selected} onClose={() => setSelected(null)} />
      )}
    </Card>
  );
}

function TaskDetailDrawer({ task, onClose }: { task: TaskView; onClose: () => void }) {
  const urls: string[] = task.result_urls || (task.result_urls_json ? JSON.parse(task.result_urls_json) : []);
  const attempts: Array<{ keyId: string; provider: string; errorClass: string; error: string }> =
    task.attempts || (task.attempts_json ? JSON.parse(task.attempts_json) : []);

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[task.status]}`}>
              {STATUS_LABEL_AR[task.status]}
            </Badge>
            <span className="text-sm font-mono">{task.id}</span>
          </DialogTitle>
          <DialogDescription>
            تفاصيل مهمة {TYPE_LABEL_AR[task.type]} — {task.model}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info label="المزوّد" value={task.provider || "—"} />
            <Info label="المفتاح المستخدم" value={task.key_id || "—"} dir="ltr" />
            <Info label="المنصة" value={PLATFORM_LABEL_AR[task.social_platform] || task.social_platform} />
            <Info label="النموذج" value={task.model} dir="ltr" />
            <Info label="أُنشئ في" value={fmtDate(task.created_at)} />
            <Info label="اكتمل في" value={fmtDate(task.completed_at)} />
          </div>
          {task.prompt && (
            <div>
              <Label className="text-xs text-muted-foreground">الوصف (Prompt)</Label>
              <div className="mt-1 rounded-md border border-border/60 bg-muted/30 p-2 text-sm" dir="auto">
                {task.prompt}
              </div>
            </div>
          )}
          {task.error_message && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
              <AlertCircle className="ml-1 inline h-3 w-3" />
              {task.error_message}
            </div>
          )}
          {urls.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">النتائج ({urls.length})</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {urls.map((u, i) => (
                  <div key={i} className="overflow-hidden rounded-md border border-border/60">
                    {task.type === "image" ? (
                      <img src={u} alt={`نتيجة ${i + 1}`} className="h-32 w-full object-cover" />
                    ) : (
                      <video src={u} controls className="h-32 w-full object-cover" />
                    )}
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      <a
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-xs text-emerald-300 hover:underline"
                        dir="ltr"
                      >
                        {u.slice(0, 40)}…
                      </a>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {attempts.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">المحاولات (Failover)</Label>
              <div className="mt-1 space-y-1">
                {attempts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-border/60 p-2 text-xs">
                    <span className="font-mono" dir="ltr">{a.provider}:{a.keyId.slice(0, 12)}</span>
                    <Badge variant="outline" className="text-xs">{a.errorClass}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, dir }: { label: string; value: string; dir?: "ltr" | "rtl" }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs" dir={dir || "rtl"}>{value}</div>
    </div>
  );
}

/* --------------------------- Generation Studio -------------------------- */

function GenerationStudio() {
  const [type, setType] = useState<"image" | "video" | "merge">("image");
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("all");
  const [aspectRatio, setAspectRatio] = useState("__auto__");
  const [duration, setDuration] = useState(5);
  const [clipUrl, setClipUrl] = useState("");
  const [clips, setClips] = useState<Array<{ url: string; type: "url" | "task_id"; label?: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const { toast } = useToast();

  async function submit() {
    if (type !== "merge" && !prompt.trim()) {
      toast({ title: "أدخل وصفًا للوسائط", variant: "destructive" });
      return;
    }
    if (type === "merge" && clips.length === 0) {
      toast({ title: "أضف على الأقل مقطعًا واحدًا للدمج", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setLastStatus(null);
    try {
      let res: { task_id: string; status: string };
      if (type === "image") {
        res = await api.generateImage({
          prompt,
          social_platform: platform,
          aspect_ratio: aspectRatio && aspectRatio !== "__auto__" ? aspectRatio : undefined,
        });
      } else if (type === "video") {
        res = await api.generateVideo({
          prompt,
          social_platform: platform,
          aspect_ratio: aspectRatio && aspectRatio !== "__auto__" ? aspectRatio : undefined,
          duration,
        });
      } else {
        res = await api.mergeVideos({ clips, social_platform: platform });
      }
      setLastTaskId(res.task_id);
      setLastStatus(res.status);
      toast({ title: "تم إنشاء المهمة", description: `task_id: ${res.task_id}` });
    } catch (e) {
      toast({
        title: "فشل إنشاء المهمة",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function addClip() {
    if (!clipUrl.trim()) return;
    const type: "url" | "task_id" = /^https?:\/\//.test(clipUrl) ? "url" : "task_id";
    setClips([...clips, { url: clipUrl.trim(), type }]);
    setClipUrl("");
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="h-4 w-4 text-emerald-400" />
          استوديو التوليد
        </CardTitle>
        <CardDescription className="text-xs">
          جرّب أدوات MCP مباشرة: صور، فيديو، أو دمج مقاطع.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={type} onValueChange={(v) => setType(v as "image" | "video" | "merge")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="image" className="gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" /> صورة
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-1.5">
              <Film className="h-3.5 w-3.5" /> فيديو
            </TabsTrigger>
            <TabsTrigger value="merge" className="gap-1.5">
              <Merge className="h-3.5 w-3.5" /> دمج
            </TabsTrigger>
          </TabsList>

          <TabsContent value="image" className="space-y-3">
            <div className="space-y-2">
              <Label>وصف الصورة (Prompt)</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="مثال: ملصق دعائي لمنتج عطور فاخر، إضاءة ذهبية، خلفية سوداء، تصميم عصري"
                rows={3}
                dir="auto"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">المنصة</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="instagram">إنستغرام</SelectItem>
                    <SelectItem value="tiktok">تيك توك</SelectItem>
                    <SelectItem value="youtube">يوتيوب</SelectItem>
                    <SelectItem value="facebook">فيسبوك</SelectItem>
                    <SelectItem value="twitter">إكس / تويتر</SelectItem>
                    <SelectItem value="linkedin">لينكدإن</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">نسبة العرض (اختياري)</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger><SelectValue placeholder="تلقائي حسب المنصة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">تلقائي</SelectItem>
                    <SelectItem value="9:16">9:16 (عمودي)</SelectItem>
                    <SelectItem value="1:1">1:1 (مربع)</SelectItem>
                    <SelectItem value="4:5">4:5 (بورتريه)</SelectItem>
                    <SelectItem value="16:9">16:9 (عرض)</SelectItem>
                    <SelectItem value="2:1">2:1 (بانر)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="video" className="space-y-3">
            <div className="space-y-2">
              <Label>وصف الفيديو (Prompt)</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="مثال: رييل قصير لشخص يكتشف منتجًا جديدًا، إضاءة سينمائية، انتقالات سريعة"
                rows={3}
                dir="auto"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">المنصة</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="tiktok">تيك توك</SelectItem>
                    <SelectItem value="instagram">إنستغرام</SelectItem>
                    <SelectItem value="youtube">يوتيوب</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">نسبة العرض</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger><SelectValue placeholder="تلقائي" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">تلقائي</SelectItem>
                    <SelectItem value="9:16">9:16</SelectItem>
                    <SelectItem value="1:1">1:1</SelectItem>
                    <SelectItem value="16:9">16:9</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">المدة (ثوانٍ)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Math.min(60, parseInt(e.target.value || "5", 10))))}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="merge" className="space-y-3">
            <div className="space-y-2">
              <Label>مقاطع للدمج (URL أو task_id لمهمة فيديو مكتملة)</Label>
              <div className="flex gap-2">
                <Input
                  value={clipUrl}
                  onChange={(e) => setClipUrl(e.target.value)}
                  placeholder="https://... أو task_id"
                  dir="ltr"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addClip())}
                />
                <Button onClick={addClip} type="button" size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {clips.length > 0 && (
              <div className="space-y-1.5">
                {clips.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                    <div className="truncate text-xs font-mono" dir="ltr">{c.url}</div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">{c.type === "url" ? "رابط" : "task_id"}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => setClips(clips.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3 w-3 text-rose-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs">المنصة المستهدفة</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="tiktok">تيك توك</SelectItem>
                  <SelectItem value="instagram">إنستغرام</SelectItem>
                  <SelectItem value="youtube">يوتيوب</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        <Button onClick={submit} disabled={submitting} className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-violet-500 text-white hover:opacity-90">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {type === "image" ? "توليد الصورة" : type === "video" ? "توليد الفيديو" : "بدء الدمج"}
        </Button>

        {lastTaskId && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-400" />
              <span>تم إنشاء المهمة:</span>
              <code className="text-xs text-emerald-300" dir="ltr">{lastTaskId}</code>
            </div>
            <p className="text-xs text-muted-foreground">
              تابع تقدّمها من تبويب «مراقب المهام». الحالة الحالية: {lastStatus || "—"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------- MCP Integration Hub ------------------------ */

function MCPIntegrationHub() {
  // Use lazy initializer for browser-only API; server renders "" then client hydrates.
  const [origin, setOrigin] = useState("");
  const [authEnabled, setAuthEnabled] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    // Reading window.location + health is browser-only; wrap in guard.
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrigin(window.location.origin);
      api
        .health()
        .then((h) => setAuthEnabled(!!h.auth))
        .catch(() => {});
    }
  }, []);

  const mcpUrl = origin ? `${origin}/mcp` : "/mcp";
  // When SITE_PASSWORD is set, MCP clients must send the password via header.
  const authHeaders = authEnabled
    ? { headers: { "x-site-password": "<YOUR_SITE_PASSWORD>" } }
    : {};
  const authNote = authEnabled
    ? "تنبيه: الحماية بكلمة السر مفعّلة. استبدل <YOUR_SITE_PASSWORD> بقيمة SITE_PASSWORD."
    : "";

  const snippets: Array<{ id: string; label: string; desc: string; code: string }> = [
    {
      id: "zai",
      label: "Z.ai / GLM",
      desc: "أضف هذا في إعدادات MCP ضمن Z.ai أو GLM agents.",
      code: JSON.stringify(
        {
          mcpServers: {
            "social-media": {
              url: mcpUrl,
              transport: "http",
              ...authHeaders,
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: "claude",
      label: "Claude Desktop",
      desc: "أضف هذا إلى ملف claude_desktop_config.json.",
      code: JSON.stringify(
        {
          mcpServers: {
            "social-media": {
              transport: {
                type: "http",
                url: mcpUrl,
                ...authHeaders,
              },
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: "cursor",
      label: "Cursor",
      desc: "أضف هذا في Settings → MCP ضمن Cursor.",
      code: JSON.stringify(
        {
          mcpServers: {
            "social-media": {
              url: mcpUrl,
              ...authHeaders,
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: "chatgpt",
      label: "ChatGPT Connectors",
      desc: "أضف رابط /mcp كـ Custom Connector في ChatGPT.",
      code:
        `# ChatGPT Custom Connector\nEndpoint: ${mcpUrl}\nMethod: POST\nContent-Type: application/json\nAccept: application/json, text/event-stream` +
        (authEnabled
          ? `\nx-site-password: <YOUR_SITE_PASSWORD>`
          : ""),
    },
  ];

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4 text-violet-400" />
          مركز تكامل MCP
        </CardTitle>
        <CardDescription className="text-xs">
          انسخ مقتطف التهيئة المناسب لعميل MCP المفضّل لديك. كل ما تحتاجه هو رابط /mcp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {authEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span dir="auto">{authNote}</span>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
          <code className="flex-1 truncate font-mono text-xs" dir="ltr">{mcpUrl}</code>
          <Button size="sm" variant="outline" onClick={() => copy(mcpUrl, "url")}>
            {copied === "url" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {snippets.map((s) => (
            <div key={s.id} className="rounded-md border border-border/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(s.code, s.id)}>
                  {copied === s.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <pre dir="ltr" className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-xs leading-relaxed">
                <code>{s.code}</code>
              </pre>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------- Page Root ---------------------------------- */

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/20">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6 sm:px-6">
        <HealthCard />
        <Tabs defaultValue="studio" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="studio" className="gap-1.5">
              <Wand2 className="h-3.5 w-3.5" /> الاستوديو
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-1.5">
              <ListVideo className="h-3.5 w-3.5" /> المهام
            </TabsTrigger>
            <TabsTrigger value="keys" className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> المفاتيح
            </TabsTrigger>
            <TabsTrigger value="mcp" className="gap-1.5">
              <Plug className="h-3.5 w-3.5" /> تكامل MCP
            </TabsTrigger>
          </TabsList>
          <TabsContent value="studio" className="mt-4">
            <GenerationStudio />
          </TabsContent>
          <TabsContent value="tasks" className="mt-4">
            <TasksMonitor />
          </TabsContent>
          <TabsContent value="keys" className="mt-4">
            <ApiKeysManager />
          </TabsContent>
          <TabsContent value="mcp" className="mt-4">
            <MCPIntegrationHub />
          </TabsContent>
        </Tabs>
      </main>
      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        MCP Media Generator • مدعوم بـ Turso و kie.ai • Next.js 16
      </footer>
    </div>
  );
}
