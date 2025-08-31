import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to community feed which is the main page
  redirect("/community");
}