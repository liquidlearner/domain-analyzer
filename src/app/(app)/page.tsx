"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Plus, Database, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } =
    trpc.admin.getStats.useQuery();

  const { data: evaluations, isLoading: evaluationsLoading } =
    trpc.evaluation.list.useQuery({});

  const isLoading = statsLoading || evaluationsLoading;

  const StatCard = ({
    title,
    value,
    subtitle,
  }: {
    title: string;
    value: string | number;
    subtitle: string;
  }) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-zinc-600">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-zinc-900">{value}</div>
        <p className="mt-1 text-xs text-zinc-600">{subtitle}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Welcome to the PD Migration Analyzer"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/customers">View Customers</Link>
            </Button>
            <Button asChild>
              <Link href="/customers">
                <Plus className="mr-2 h-4 w-4" />
                New Evaluation
              </Link>
            </Button>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-600">
                  Total Customers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-600">
                  Total Evaluations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-600">
                  Connected Domains
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-600">
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <StatCard
              title="Total Customers"
              value={stats?.totalCustomers || 0}
              subtitle={
                (stats?.totalCustomers || 0) === 1
                  ? "1 customer"
                  : `${stats?.totalCustomers || 0} customers`
              }
            />
            <StatCard
              title="Total Evaluations"
              value={
                Object.values(stats?.evaluationsByStatus || {}).reduce(
                  (a: number, b: any) => a + (b as number),
                  0
                ) || 0
              }
              subtitle="Across all statuses"
            />
            <StatCard
              title="Connected Domains"
              value={
                (stats?.domainsByStatus?.["CONNECTED"] || 0) +
                (stats?.domainsByStatus?.["VALIDATING"] || 0) || 0
              }
              subtitle={`${stats?.totalDomains || 0} total domains`}
            />
            <StatCard
              title="Recent Activity"
              value={stats?.recentActivityCount || 0}
              subtitle="Last 7 days"
            />
          </>
        )}
      </div>

      {/* Evaluation Status Breakdown */}
      {!statsLoading && stats?.evaluationsByStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Evaluation Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(stats.evaluationsByStatus).map(([status, count]: [string, any]) => (
                <div
                  key={status}
                  className="bg-zinc-50 rounded-lg p-4 border border-zinc-200"
                >
                  <p className="text-xs font-semibold text-zinc-600 uppercase">
                    {status}
                  </p>
                  <p className="text-2xl font-bold text-zinc-900 mt-2">
                    {count}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Evaluations Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Recent Evaluations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {evaluationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
            </div>
          ) : evaluations?.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No evaluations yet"
              description="Connect a PD domain to get started"
              action={
                <Button asChild>
                  <Link href="/customers">
                    <Plus className="mr-2 h-4 w-4" />
                    New Evaluation
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluations?.slice(0, 10).map((evaluation: any) => (
                    <TableRow key={evaluation.id}>
                      <TableCell className="font-medium">
                        {evaluation.domain?.domain || "Unknown"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={evaluation.status}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-zinc-600">
                        {formatDate(evaluation.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/evaluations/${evaluation.id}`}>
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
