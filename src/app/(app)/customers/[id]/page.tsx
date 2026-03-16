"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Trash2, Edit2, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import DomainConnectForm from "@/components/features/domain-connect-form";
import { formatDate } from "@/lib/utils";

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const { toast } = useToast();
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

  const { data: customer, isLoading, error, refetch } = trpc.customer.getById.useQuery({
    id: customerId,
  });

  const { data: domains } = trpc.domain.list.useQuery({
    customerId,
  });

  const deleteMutation = trpc.customer.delete.useMutation();

  const handleDeleteCustomer = async () => {
    if (!window.confirm("Are you sure you want to delete this customer and all associated domains?")) {
      return;
    }

    try {
      await deleteMutation.mutateAsync({ id: customerId });
      toast({
        title: "Success",
        description: "Customer deleted successfully",
      });
      window.location.href = "/customers";
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete customer",
        variant: "destructive",
      });
    }
  };

  const handleDomainConnectSuccess = () => {
    setIsConnectDialogOpen(false);
    refetch();
    toast({
      title: "Success",
      description: "Domain connected successfully",
    });
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (error || !customer) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Failed to load customer</p>
        <Button asChild className="mt-4">
          <Link href="/customers">Back to Customers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description="Manage customer details and connected domains"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/customers/${customerId}/edit`}>
                <Edit2 className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCustomer}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        }
      />

      {/* Customer Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">
              Industry
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold">{customer.industry || "-"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">
              PD Contract Renewal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold">
              {customer.pdContractRenewal
                ? formatDate(customer.pdContractRenewal)
                : "-"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">
              Created By
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold">{customer.createdBy.name}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">
              Created Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold">
              {formatDate(customer.createdAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Notes Card */}
      {customer.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-600 whitespace-pre-wrap">
              {customer.notes}
            </p>
          </CardContent>
        </Card>
      )}

      {/* PD Domains Section */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>PagerDuty Domains</CardTitle>
          <Dialog
            open={isConnectDialogOpen}
            onOpenChange={setIsConnectDialogOpen}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Connect Domain
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Connect PagerDuty Domain</DialogTitle>
                <DialogDescription>
                  Connect a new PagerDuty domain to this customer
                </DialogDescription>
              </DialogHeader>
              <DomainConnectForm
                customerId={customerId}
                onSuccess={handleDomainConnectSuccess}
                onCancel={() => setIsConnectDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {!domains || domains.length === 0 ? (
            <EmptyState
              title="No domains connected"
              description="Connect your first PagerDuty domain to get started"
              action={
                <Dialog
                  open={isConnectDialogOpen}
                  onOpenChange={setIsConnectDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Connect Domain
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Connect PagerDuty Domain</DialogTitle>
                      <DialogDescription>
                        Connect a new PagerDuty domain to this customer
                      </DialogDescription>
                    </DialogHeader>
                    <DomainConnectForm
                      customerId={customerId}
                      onSuccess={handleDomainConnectSuccess}
                      onCancel={() => setIsConnectDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subdomain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Token (Last 4)</TableHead>
                    <TableHead>Last Validated</TableHead>
                    <TableHead className="w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain: any) => (
                    <TableRow key={domain.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/domains/${domain.id}`}
                          className="hover:underline"
                        >
                          {domain.subdomain}.pagerduty.com
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={domain.status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        ••••{domain.tokenLast4}
                      </TableCell>
                      <TableCell>
                        {domain.lastValidated
                          ? formatDate(domain.lastValidated)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                        >
                          <Link href={`/domains/${domain.id}`}>
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