"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import AddCustomerForm from "@/components/features/add-customer-form";
import { formatDate } from "@/lib/utils";

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, error } = trpc.customer.list.useQuery({
    search,
    page,
    limit: 10,
  });

  const handleAddCustomerSuccess = () => {
    setIsDialogOpen(false);
    toast({
      title: "Success",
      description: "Customer created successfully",
    });
  };

  if (error) {
    toast({
      title: "Error",
      description: "Failed to load customers",
      variant: "destructive",
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Manage your PagerDuty customers"
        actions={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Customer</DialogTitle>
                <DialogDescription>
                  Add a new customer to the system
                </DialogDescription>
              </DialogHeader>
              <AddCustomerForm onSuccess={handleAddCustomerSuccess} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <div className="p-4 border-b">
          <Input
            placeholder="Search customers by name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm"
          />
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-zinc-500">Loading...</div>
        ) : data?.customers.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No customers yet"
              description="Create your first customer to get started"
              action={
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Customer
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Customer</DialogTitle>
                      <DialogDescription>
                        Add a new customer to the system
                      </DialogDescription>
                    </DialogHeader>
                    <AddCustomerForm onSuccess={handleAddCustomerSuccess} />
                  </DialogContent>
                </Dialog>
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>PD Renewal Date</TableHead>
                    <TableHead className="text-right">Domains</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.customers.map((customer: any) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="hover:underline"
                        >
                          {customer.name}
                        </Link>
                      </TableCell>
                      <TableCell>{customer.industry || "-"}</TableCell>
                      <TableCell>
                        {customer.pdContractRenewal
                          ? formatDate(customer.pdContractRenewal)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.domainCount}
                      </TableCell>
                      <TableCell>{formatDate(customer.createdAt)}</TableCell>
                      <TableCell>
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                        >
                          <Link href={`/customers/${customer.id}`}>
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
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