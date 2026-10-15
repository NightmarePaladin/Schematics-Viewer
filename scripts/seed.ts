import { seed, USERS, ENV } from "./lib/seed-lib";

seed()
  .then((r) => {
    console.log("Seed complete.\n");
    console.log("Demo sign-ins (password from SEED_PASSWORD, default shown in .env.example):");
    for (const u of Object.values(USERS)) console.log(`  ${u.email}`);
    console.log(`\nOrganization: ${r.orgId}\nPassword set: ${ENV.password.replace(/./g, "*")}`);
  })
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
