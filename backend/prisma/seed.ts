import { PrismaClient } from "@prisma/client";
import { createEtherealAccount } from "../src/services/mailer";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL ?? "demo@example.com";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Demo User" },
  });
  console.log(`User ready: ${user.email} (${user.id})`);

  const existing = await prisma.sender.count({ where: { userId: user.id } });
  if (existing > 0) {
    console.log(`User already has ${existing} sender(s), skipping sender creation.`);
    return;
  }

  for (const name of ["Marketing", "Sales"]) {
    const account = await createEtherealAccount();
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name,
        email: account.smtpUser,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpUser: account.smtpUser,
        smtpPass: account.smtpPass,
        hourlyLimit: 200,
      },
    });
    console.log(`Created sender "${sender.name}" -> ${sender.email} (Ethereal inbox, log in at https://ethereal.email)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
