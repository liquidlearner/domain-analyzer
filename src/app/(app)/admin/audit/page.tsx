"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

const ACTIONS = [
  "UPDATE_ROLE",
  "CONNECT_DOMAIN",
  "DISCONNECT_DOMAIN",
  "START_EVALUATION",
  "COMPLETE_EVALUATION",
];

const ENTITY_TYPES = [
  "USER",
  "DOMAIN",
  "EVALUATION",
  "CUSTOMER",
  "RESOURCE",
];

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    userId: "",
    startDate: "",
    endDate: "",
  });
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const { data, isLoading } = trpc.admin.listAuditLogs.useQuery({
    page,
    limit: 50,
    ...filters,
  });

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
      setPage(1);
    },
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track all system changes and user actions"
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Action
            </label>
            <Select value={filters.action} onValueChange={(v) => handleFilterChange("action", v)}>
              <SelectTrigger>
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All actions</SelectItem>
                {ACTIONS.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Entity Type
            </label>
            <Select
              value={filters.entityType}
              onValueChange={(v) => handleFilterChange("entityType", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              From Date
            </label>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange("startDate", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              To Date
            </label>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange("endDate", e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                setFilters({
                  action: "",
                  entityType: "",
                  userId: "",
                  startDate: "",
                  endDate: "",
                })
              }
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Audit Table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-zinc-500">
            Loading audit logs...
          </div>
        ) : data?.logs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">No logs found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead className="text-right">IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.logs.map((log: any) => (
                    <>
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-zinc-50"
                        onClick={() =>
                          setExpandedLog(
                            expandedLog === log.id ? null : log.id
                          )
                        }
                      >
                        <TableCell>
                          <button className="p-1">
                            {expandedLog === log.id ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {log.user?.email || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                            {log.action}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600">
                          {log.entityType}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-zinc-600">
                          {log.entityId}
                        </TableCell>
                        <TableCell className="text-sm text-right text-zinc-600">
                          {log.ipAddress || "-"}
                        </TableCell>
                      </TableRow>
                      {expandedLog === log.id && log.metadataJson && (
                        <TableRow className="bg-zinc-50">
                          <TableCell colSpan={7}>
                            <div className="p-4 bg-zinc-100 rounded font-mono text-xs text-zinc-700 overflow-x-auto">
                              <pre>
                                {JSON.stringify(log.metadataJson, null, 2)}
                              </pre>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data && data.pages > 1 && (
              <div className="flex items-center justify-between p-4 border-t">
                <div className="text-sm text-zinc-600">
                  Page {page} of {data.pages} ({data.total} total)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === data.pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
