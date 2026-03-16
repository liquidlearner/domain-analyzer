import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create default admin user (matches dev login bypass)
  const admin = await prisma.user.upsert({
    where: { email: "dev@incident.io" },
    update: {},
    create: {
      email: "dev@incident.io",
      name: "Dev Admin",
      role: "ADMIN",
    },
  });
  console.log(`  Created admin user: ${admin.email}`);

  // Create a sample SA/SE user
  const sa = await prisma.user.upsert({
    where: { email: "sa@incident.io" },
    update: {},
    create: {
      email: "sa@incident.io",
      name: "Sample SA",
      role: "SA_SE",
    },
  });
  console.log(`  Created SA user: ${sa.email}`);

  // Create a sample customer
  const customer = await prisma.customer.upsert({
    where: {
      id: "seed-customer-acme",
    },
    update: {},
    create: {
      id: "seed-customer-acme",
      name: "Acme Corp",
      industry: "Technology",
      notes: "Sample customer for development testing.",
      createdById: admin.id,
    },
  });
  console.log(`  Created customer: ${customer.name}`);

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
