"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

interface UserStats {
  totalSubmissions: number;
  successfulSubmissions: number;
  activitiesAttempted: number;
  problemsAttempted: number;
  avgExecutionTime: number;
  successRate: number;
}

interface Activity {
  id: string;
  title: string;
  prompt: string;
  problemCount: number;
  createdAt: string;
}

interface Submission {
  id: number;
  activity_id: string;
  problem_id: string;
  success: boolean;
  passed_tests: number;
  total_tests: number;
  submitted_at: string;
}

interface ProfileData {
  user: {
    id: number;
    username: string;
    email: string;
    displayName: string;
    createdAt: string;
  };
  stats: UserStats;
  activities: Activity[];
  recentSubmissions: Submission[];
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("codem-token");
    if (!token) {
      router.push("/auth/login");
      return;
    }

    async function fetchProfile() {
      try {
        const res = await fetch(`${BACKEND_URL}/profile`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("codem-token");
          router.push("/auth/login");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to fetch profile");
        }

        const data = await res.json();
        setProfile(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [router]);

  function handleLogout() {
    localStorage.removeItem("codem-token");
    router.push("/");
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-600">Loading profile...</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <p className="text-red-600">{error || "Failed to load profile"}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Profile
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back, {profile.user.displayName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Home
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-full bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-medium text-slate-500">Total Submissions</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {profile.stats.totalSubmissions}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-medium text-slate-500">Success Rate</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-600">
              {profile.stats.successRate}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-medium text-slate-500">Activities</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {profile.stats.activitiesAttempted}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-medium text-slate-500">Problems Solved</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {profile.stats.problemsAttempted}
            </p>
          </div>
        </div>

        {/* Activities and Recent Submissions */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Activities */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Your Activities
            </h2>
            {profile.activities.length === 0 ? (
              <p className="text-sm text-slate-500">
                No activities yet. Create your first one!
              </p>
            ) : (
              <div className="space-y-3">
                {profile.activities.slice(0, 5).map((activity) => (
                  <Link
                    key={activity.id}
                    href={`/activity/${activity.id}`}
                    className="block rounded-lg border border-slate-200 p-4 transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-slate-900">
                          {activity.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {activity.problemCount || 0} problems • Created{" "}
                          {formatDate(activity.createdAt)}
                        </p>
                      </div>
                      <svg
                        className="h-5 w-5 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent Submissions */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Recent Submissions
            </h2>
            {profile.recentSubmissions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No submissions yet. Start solving problems!
              </p>
            ) : (
              <div className="space-y-3">
                {profile.recentSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-4"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {submission.problem_id}
                      </p>
                      <p className="text-xs text-slate-500">
                        {submission.passed_tests}/{submission.total_tests} tests passed
                        • {formatDate(submission.submitted_at)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        submission.success
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {submission.success ? "Passed" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* User Info */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Account Information
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-slate-500">Username</dt>
              <dd className="mt-1 text-sm text-slate-900">{profile.user.username}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Email</dt>
              <dd className="mt-1 text-sm text-slate-900">{profile.user.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Member Since</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatDate(profile.user.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">User ID</dt>
              <dd className="mt-1 text-sm text-slate-900">{profile.user.id}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
