export const EXAMPLES = [
  {
    name: 'Order pipeline',
    source: `flowchart LR
  shop([Storefront]) --> api[Orders API]
  api --> valid{Valid?}
  valid -->|no| reject[Reject order]
  valid -->|yes| pay[Charge card]
  subgraph fulfil [Fulfilment]
    pay --> pick[Pick and pack]
    pick --> ship[Ship]
  end
  ship --> notify[Email receipt]
  reject --> notify

%% @layout v1
%% reject  nudge -352,38
%% notify  nudge 0,100
%% @end
`,
  },
  {
    name: 'Event architecture',
    source: `flowchart LR
  users([Users]) --> cdn[CloudFront<br/>path routing]
  cdn --> dns[Route 53<br/>latency routing]
  dns --> api[API Gateway<br/>REST]
  fs[Storage Gateway<br/>file systems] -- file changes --> s3[S3<br/>ingestion]
  dms[DMS<br/>CDC events] -- db changes --> kin[Kinesis<br/>CDC stream]
  kin --> s3
  subgraph region [Region]
    s3 --> bus[[EventBridge<br/>event bus]]
    api -- async write --> bus
    api --> query[Lambda<br/>query]
    subgraph logic [Logic layer]
      fn[Lambda<br/>microservices]
      saga[Step Functions<br/>saga]
    end
    subgraph data [Data layer]
      ddb[(DynamoDB<br/>single view)]
      aurora[(Aurora<br/>report DB)]
      lake[(S3<br/>data lake)]
    end
    bus --> fn
    bus --> saga
    fn -- logic events --> bus
    query --> ddb
    fn --> ddb
    saga --> aurora
    ddb -.-> lake
  end
`,
  },
  {
    name: 'Deployment lifecycle',
    source: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : open PR
  Review --> Draft : changes requested
  Review --> Deploying : approved
  state Deploying {
    [*] --> Canary
    Canary --> Fleet : healthy
    Canary --> Rollback : alarms
  }
  Deploying --> Live
  Rollback --> Draft
  Live --> [*]
`,
  },
  {
    name: 'Billing model',
    source: `classDiagram
  class Customer {
    +UUID id
    +String email
    +open() Account
  }
  class Account {
    +Money balance
    +charge(Money amount)
  }
  class Invoice {
    +Date issued
    +Money total
  }
  class LineItem {
    +String sku
    +int qty
  }
  Customer "1" --> "*" Account : owns
  Account "1" --> "*" Invoice : bills
  Invoice *-- LineItem
`,
  },
  {
    name: 'Sign-in (sequence)',
    source: `sequenceDiagram
  participant B as Browser
  participant A as Auth service
  participant D as User store
  B->>A: POST /sign-in
  A->>D: look up user
  D-->>A: user record
  A-->>B: session cookie
`,
  },
];
