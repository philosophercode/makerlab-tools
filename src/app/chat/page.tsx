import Chat from "@/components/Chat";
import { siteConfig } from "@/lib/site-config";

export const metadata = {
  title: `Chat — ${siteConfig.name}`,
  description: `Ask questions about ${siteConfig.institution} ${siteConfig.name.replace("Tools", "").trim()} tools and equipment.`,
};

export default function ChatPage() {
  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] lg:mx-auto lg:max-w-3xl lg:px-4 lg:py-8 lg:h-auto lg:block">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden lg:h-[calc(100vh-150px)] lg:rounded-xl lg:border lg:border-card-border lg:bg-card-bg lg:flex-none">
        <Chat
          header={siteConfig.chatAssistantName}
          suggestions={[
            "How do I laser cut a custom phone stand?",
            "Show me how to 3D print an enclosure for my Arduino",
            "I want to make a wooden jewelry box — what steps do I follow?",
            "What tools can cut acrylic?",
          ]}
        />
      </div>
    </div>
  );
}
