import { migrate } from "../db/migrate";

const url = process.env.TEST_DATABASE_URL ?? "postgres://trykt:trykt@127.0.0.1:5432/trykt_test";

export default async function setup() {
  process.env.DATABASE_URL = url;
  await migrate(url);
}
