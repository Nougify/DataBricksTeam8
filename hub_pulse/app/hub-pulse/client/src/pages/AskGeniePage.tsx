import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  GenieChatInput,
  GenieChatMessageList,
  useGenieChat,
} from '@databricks/appkit-ui/react';
import { Loader2, MessageSquarePlus, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';

const SUGGESTED = [
  'Which bus lines serving UBC are the most overcrowded?',
  'When is Park Royal Mall most underserved on Saturdays?',
  'Which origins have no direct ride to UBC, and how big are they?',
  'What were the 5 biggest surge days at Waterfront Station?',
  'What should TransLink do first at Waterfront Station?',
];

const STATUS_TEXT: Record<string, string> = {
  streaming: 'Genie is writing SQL and querying the gold tables…',
  'loading-history': 'Loading this conversation…',
  'loading-older': 'Loading earlier messages…',
};

export function AskGeniePage({ userEmail }: { userEmail: string | null }) {
  const { messages, status, error, sendMessage, reset } = useGenieChat({ alias: 'default' });
  const busy = status === 'streaming' || status === 'loading-history';

  const lastQuery = useMemo(() => {
    for (const m of [...messages].reverse()) {
      for (const a of m.attachments ?? []) if (a.query?.query) return a.query;
    }
    return null;
  }, [messages]);

  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
      <Card className="xl:col-span-2 flex flex-col h-[calc(100vh-220px)] min-h-[560px]">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Ask about the three hubs in plain English</CardTitle>
              <CardDescription>Genie turns your question into SQL over the Hub Pulse gold tables, runs it, and explains the answer.</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={reset} disabled={busy || messages.length === 0}>
              <MessageSquarePlus className="h-4 w-4 mr-1" />New chat
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
          {messages.length === 0 && status === 'idle' ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyTitle>Start with a question</EmptyTitle>
                <EmptyDescription>Or pick one of these:</EmptyDescription>
              </EmptyHeader>
              <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                {SUGGESTED.map((q) => (
                  <Button key={q} variant="secondary" size="sm" className="h-auto whitespace-normal text-left" onClick={() => sendMessage(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </Empty>
          ) : (
            <GenieChatMessageList messages={messages} status={status} className="flex-1 min-h-0 whitespace-pre-wrap" />
          )}
          {STATUS_TEXT[status] && (
            <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{STATUS_TEXT[status]}
            </p>
          )}
          {status === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>{error ?? 'Genie could not answer. Rephrase the question or start a new chat.'}</AlertDescription>
            </Alert>
          )}
          <GenieChatInput onSend={sendMessage} disabled={busy} placeholder="e.g. When is UBC most underserved on weekdays?" />
          <p className="text-xs text-muted-foreground">
            AI-generated from the Hub Pulse tables via Databricks Genie — it can be wrong. Check the generated SQL before relying on an answer.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-success" aria-hidden />Who is asking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge variant="secondary">{userEmail ?? 'Signed-in Databricks user'}</Badge>
            <p className="text-muted-foreground">
              Genie runs <span className="font-medium text-foreground">on your behalf</span> (this app requests the <code>dashboards.genie</code> user scope), so answers only include data your own Unity Catalog permissions allow.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Generated SQL</CardTitle>
            <CardDescription>{lastQuery?.title ?? lastQuery?.description ?? 'The query behind the latest answer appears here.'}</CardDescription>
          </CardHeader>
          <CardContent>
            {lastQuery?.query ? (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs leading-relaxed">{lastQuery.query}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No query yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
