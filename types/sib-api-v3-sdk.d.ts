declare module 'sib-api-v3-sdk' {
  export class TransactionalEmailsApi {
    setApiKey(key: string, value: string): void;
    sendTransacEmail(emailData: SendSmtpEmail): Promise<any>;
  }

  export class SendSmtpEmail {
    constructor(data: {
      sender: { name: string; email: string };
      to: Array<{ email: string }>;
      subject: string;
      textContent: string;
    });
  }

  export namespace TransactionalEmailsApiApiKeys {
    const apiKey: string;
  }
} 