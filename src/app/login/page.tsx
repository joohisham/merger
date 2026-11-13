"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "كلمة السر غير صحيحة");
        return;
      }
      // Cookie is now set; navigate to the dashboard.
      router.push("/");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-muted/20 px-4">
      <Card className="w-full max-w-md border-border/60">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-violet-500 text-white shadow-lg shadow-violet-500/20">
            <Sparkles className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">تسجيل الدخول</CardTitle>
          <CardDescription>أدخل كلمة السر للوصول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">كلمة السر</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  dir="ltr"
                  placeholder="••••••••••••"
                  className="pr-10"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-rose-400" dir="auto">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              disabled={loading || !password}
              className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-violet-500 text-white hover:opacity-90"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              دخول
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
