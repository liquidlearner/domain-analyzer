import { useState, useMemo } from "react";
import { ChevronDown, Code } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MigrationMapping {
  id: string;
  conversionStatus: "AUTO" | "MANUAL" | "SKIP" | "UNSUPPORTED";
  effortEstimate?: string | null;
  notes?: string | null;
  ioTfSnippet?: string | null;
  pdResource: {
    pdType: string;
    name: string;
    id: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = any;

type ConversionStatus = "AUTO" | "MANUAL" | "SKIP" | "UNSUPPORTED";
type ResourceType = string;

interface ConfigMapTabProps {
  evaluation: Evaluation;
}

export default function ConfigMapTab({ evaluation }: ConfigMapTabProps) {
  const [filterStatus, setFilterStatus] = useState<ConversionStatus | "all">("all");
  const [filterType, setFilterType] = useState<ResourceType | "all">("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const mappings: MigrationMapping[] = evaluation.migrationMappings || [];

  const { filteredMappings, resourceTypes, statusCounts } = useMemo(() => {
    const resourceTypes = new Set(mappings.map((m) => m.pdResource?.pdType).filter(Boolean));
    const statusCounts: Record<ConversionStatus | "all", number> = {
      all: mappings.length,
      AUTO: mappings.filter((m) => m.conversionStatus === "AUTO").length,
      MANUAL: mappings.filter((m) => m.conversionStatus === "MANUAL").length,
      SKIP: mappings.filter((m) => m.conversionStatus === "SKIP").length,
      UNSUPPORTED: mappings.filter((m) => m.conversionStatus === "UNSUPPORTED").length,
    };

    let filtered = mappings;
    if (filterStatus !== "all") {
      filtered = filtered.filter((m) => m.conversionStatus === filterStatus);
    }
    if (filterType !== "all") {
      filtered = filtered.filter((m) => m.pdResource?.pdType === filterType);
    }

    return {
      filteredMappings: filtered,
      resourceTypes: Array.from(resourceTypes).sort(),
      statusCounts,
    };
  }, [mappings, filterStatus, filterType]);

  const toggleRow = (id: string) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedRows(newSet);
  };

  const getStatusBadge = (status: ConversionStatus) => {
    switch (status) {
      case "AUTO":
        return "bg-green-100 text-green-800";
      case "MANUAL":
        return "bg-yellow-100 text-yellow-800";
      case "UNSUPPORTED":
        return "bg-red-100 text-red-800";
      case "SKIP":
        return "bg-zinc-100 text-zinc-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-2">Conversion Status</label>
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({statusCounts.all})</SelectItem>
                  <SelectItem value="AUTO">Auto ({statusCounts.AUTO})</SelectItem>
                  <SelectItem value="MANUAL">Manual ({statusCounts.MANUAL})</SelectItem>
                  <SelectItem value="SKIP">Skip ({statusCounts.SKIP})</SelectItem>
                  <SelectItem value="UNSUPPORTED">Unsupported ({statusCounts.UNSUPPORTED})</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">Resource Type</label>
              <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {resourceTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Resource Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Conversion Status</TableHead>
                  <TableHead>Effort Estimate</TableHead>
                  <TableHead>incident.io Equivalent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-zinc-500 py-8">
                      No resources match the selected filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell>
                        {mapping.ioTfSnippet && (
                          <button
                            onClick={() => toggleRow(mapping.id)}
                            className="p-1 hover:bg-zinc-100 rounded"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                expandedRows.has(mapping.id) ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{mapping.pdResource?.pdType}</TableCell>
                      <TableCell className="font-medium">{mapping.pdResource?.name}</TableCell>
                      <TableCell>
                        <Badge className={getStatusBadge(mapping.conversionStatus)}>
                          {mapping.conversionStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-600">
                        {mapping.effortEstimate || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-zinc-600">
                        {mapping.notes || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* TF Snippets */}
      {Array.from(expandedRows).map((id) => {
        const mapping = filteredMappings.find((m) => m.id === id);
        if (!mapping?.ioTfSnippet) return null;

        return (
          <Card key={`snippet-${id}`} className="bg-zinc-50">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Code className="h-4 w-4" />
                Draft Terraform Snippet: {mapping.pdResource?.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-white border border-zinc-200 rounded-lg p-4 text-xs overflow-x-auto">
                <code>{mapping.ioTfSnippet}</code>
              </pre>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}