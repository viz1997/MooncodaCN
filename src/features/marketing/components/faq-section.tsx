"use client";

import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Section, SectionHeader } from "./section";

export function FAQSection() {
  const t = useTranslations("FAQ");

  const faqItems = [
    {
      question: t("items.0.question"),
      answer: t("items.0.answer"),
    },
    {
      question: t("items.1.question"),
      answer: t("items.1.answer"),
    },
    {
      question: t("items.2.question"),
      answer: t("items.2.answer"),
    },
  ];

  return (
    <Section container="narrow">
      <SectionHeader eyebrow={t("label")} title={t("title")} align="center" />

      <Reveal delay={0.08}>
        <Accordion type="single" collapsible className="w-full">
          {faqItems.map((faq, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static FAQ list
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent>{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </Section>
  );
}
