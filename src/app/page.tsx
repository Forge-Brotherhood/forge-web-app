import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to pray page which is the main page
  redirect("/pray");
}