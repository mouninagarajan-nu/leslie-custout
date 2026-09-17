import { Suspense } from 'react';
import ContactsClient from './ContactsClient';

export const metadata = {
  title: "Leslie's - Contacts"
};

export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsClient />
    </Suspense>
  );
}
