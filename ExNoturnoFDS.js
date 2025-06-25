/*
 * Expansão do Foda-se (V04) - Criado por AmmieNyami, através de modificações ao script de
 *                             DarkMode e marcos10pc.
 *
 * Baseado no Expansão do Foda-se (V03) por DarkMode (https://github.com/DarkModde/Dark-Scripts).
 *
 * O Expansão do Foda-se (V03) do DarkMode foi, por sua vez, baseado na versão original criada
 * por marcos10pc (Ex. Noturna Cheeto).
 *
 * Comentário original do DarkMode:
 *
 *  // Script originalmente desenvolvido por marcos10pc ( Ex. Noturna Cheeto )
 *  // Eu apenas roubei ( ÓBVIO ), modifiquei, aprimorei
 *  // e também deixei mais bonito KKKK
 */

// Ainda utilizando o ProtectionScript do DarkMode. Não sei exatamente a utilidade dessa
// "Proteção", mas estou mantendo por precaução.
const script = document.createElement("script");
script.src =
  "https://cdn.jsdelivr.net/gh/DarkModde/Dark-Scripts/ProtectionScript.js";
document.head.appendChild(script);

console.clear();
const noop = () => {};
console.warn = console.error = window.debug = noop;

class UrlHelper {
  static extractUrlParam(url, paramName) {
    return new URL(url).searchParams.get(paramName);
  }

  static extractByRegex(text, regex) {
    const match = text.match(regex);
    return match?.[1];
  }

  static createUrl(baseUrl, path, params = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    return url.toString();
  }
}

class RequestManager {
  constructor(baseUrl = "https://expansao.educacao.sp.gov.br", maxRetries = 3) {
    this.baseUrl = baseUrl;
    this.maxRetries = maxRetries;
    this.defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
    };
  }

  async fetchWithRetry(url, options = {}, retries = this.maxRetries) {
    const fullUrl = url.startsWith("http")
      ? url
      : UrlHelper.createUrl(this.baseUrl, url);
    const response = await fetch(fullUrl, {
      credentials: "include",
      headers: this.defaultHeaders,
      ...options,
    });

    if (!response.ok && retries > 0) {
      const delay = Math.pow(2, this.maxRetries - retries) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.fetchWithRetry(url, options, retries - 1);
    }
    return response;
  }
}

class ExamAutomator {
  constructor() {
    this.requestManager = new RequestManager();
  }

  async fetchExamPage(examUrl) {
    const response = await this.requestManager.fetchWithRetry(examUrl);
    const pageText = await response.text();
    const contextId =
      UrlHelper.extractUrlParam(examUrl, "id") ||
      UrlHelper.extractByRegex(pageText, /contextInstanceId":(\d+)/);
    const sessKey = UrlHelper.extractByRegex(pageText, /sesskey":"([^"]+)/);

    return { contextId, sessKey };
  }

  async startExamAttempt(contextId, sessKey) {
    const formData = new URLSearchParams({
      cmid: contextId,
      sesskey: sessKey,
    });

    const response = await this.requestManager.fetchWithRetry(
      "/mod/quiz/startattempt.php",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
        redirect: "follow",
      },
    );

    const redirectUrl = response.url;
    const attemptId = UrlHelper.extractByRegex(redirectUrl, /attempt=(\d+)/);

    return { redirectUrl, attemptId };
  }

  async extractQuestionInfo(questionUrl) {
    const response = await this.requestManager.fetchWithRetry(questionUrl);
    const pageText = await response.text();
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(pageText, "text/html");

    const questionData = {
      questId: null,
      seqCheck: null,
      options: [],
      attempt: null,
      sesskey: null,
      formFields: {},
    };

    htmlDoc.querySelectorAll("input[type='hidden']").forEach((input) => {
      const name = input.getAttribute("name");
      const value = input.getAttribute("value");
      if (!name) return;

      if (name.includes(":sequencecheck")) {
        questionData.questId = name.split(":")[0];
        questionData.seqCheck = value;
      } else if (name === "attempt") {
        questionData.attempt = value;
      } else if (name === "sesskey") {
        questionData.sesskey = value;
      } else if (
        ["thispage", "nextpage", "timeup", "mdlscrollto", "slots"].includes(
          name,
        )
      ) {
        questionData.formFields[name] = value;
      }
    });

    htmlDoc.querySelectorAll("input[type='radio']").forEach((input) => {
      const name = input.getAttribute("name");
      const value = input.getAttribute("value");
      if (name?.includes("_answer") && value !== "-1") {
        questionData.options.push({ name, value });
      }
    });

    return questionData;
  }

  async submitAnswer(questionData, contextId) {
    const selectedOption =
      questionData.options[
        Math.floor(Math.random() * questionData.options.length)
      ];

    const formData = new FormData();
    formData.append(`${questionData.questId}:1_:flagged`, "0");
    formData.append(
      `${questionData.questId}:1_:sequencecheck`,
      questionData.seqCheck,
    );
    formData.append(selectedOption.name, selectedOption.value);
    formData.append("next", "Finalizar tentativa ...");
    formData.append("attempt", questionData.attempt);
    formData.append("sesskey", questionData.sesskey);
    formData.append("slots", "1");

    Object.entries(questionData.formFields).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const url = `/mod/quiz/processattempt.php?cmid=${contextId}`;
    const response = await this.requestManager.fetchWithRetry(url, {
      method: "POST",
      body: formData,
      redirect: "follow",
    });

    return {
      redirectUrl: response.url,
      attemptId: questionData.attempt,
      sesskey: questionData.sesskey,
    };
  }

  async finishExamAttempt(attemptId, contextId, sesskey) {
    await this.requestManager.fetchWithRetry(
      `/mod/quiz/summary.php?attempt=${attemptId}&cmid=${contextId}`,
    );

    const formData = new URLSearchParams({
      attempt: attemptId,
      finishattempt: "1",
      timeup: "0",
      slots: "",
      cmid: contextId,
      sesskey: sesskey,
    });

    const response = await this.requestManager.fetchWithRetry(
      "/mod/quiz/processattempt.php",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
        redirect: "follow",
      },
    );

    return response.url;
  }

  async completeExam(examUrl) {
    const { contextId, sessKey } = await this.fetchExamPage(examUrl);
    const { redirectUrl, attemptId } = await this.startExamAttempt(
      contextId,
      sessKey,
    );
    const questionData = await this.extractQuestionInfo(redirectUrl);
    const { attemptId: finalAttemptId, sesskey } = await this.submitAnswer(
      questionData,
      contextId,
    );

    return await this.finishExamAttempt(finalAttemptId, contextId, sesskey);
  }
}

class PageCompletionService {
  constructor() {
    this.requestManager = new RequestManager();
  }

  async markPageAsCompleted(pageId) {
    const url = `/mod/resource/view.php?id=${pageId}`;
    await this.requestManager.fetchWithRetry(url);
  }
}

class NotificationManager {
  constructor() {
    this.notificationContainer = document.createElement("div");
    this.notificationContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      max-width: 350px;
      font-family: 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    `;
    document.body.appendChild(this.notificationContainer);
    this.injectStyles();
  }

  injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes notificationSlideIn {
        0% { transform: translateX(100%); opacity: 0; }
        100% { transform: translateX(0); opacity: 1; }
      }
      @keyframes notificationFadeOut {
        0% { transform: translateX(0); opacity: 1; }
        100% { transform: translateX(100%); opacity: 0; }
      }
      .notification {
        background: #fff;
        color: #333;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: notificationSlideIn 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        display: flex;
        align-items: center;
        position: relative;
        overflow: hidden;
        border-left: 4px solid;
      }
      .notification.success {
        border-left-color: #4CAF50;
      }
      .notification.error {
        border-left-color: #F44336;
      }
      .notification.info {
        border-left-color: #2196F3;
      }
      .notification::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 4px;
        background: linear-gradient(90deg, rgba(0,0,0,0.1), rgba(0,0,0,0));
      }
      .notification-icon {
        width: 24px;
        height: 24px;
        margin-right: 15px;
        flex-shrink: 0;
      }
      .notification-content {
        flex-grow: 1;
      }
      .notification-title {
        font-weight: 600;
        margin-bottom: 5px;
        font-size: 15px;
      }
      .notification-message {
        font-size: 14px;
        color: #555;
      }
    `;
    document.head.appendChild(style);
  }

  getIcon(type) {
    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="#4CAF50"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
      error: `<svg viewBox="0 0 24 24" fill="#F44336"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
      info: `<svg viewBox="0 0 24 24" fill="#2196F3"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
    };
    return icons[type] || icons.info;
  }

  showNotification(title, message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;

    notification.innerHTML = `
      <div class="notification-icon">${this.getIcon(type)}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
      </div>
    `;

    this.notificationContainer.appendChild(notification);

    setTimeout(() => {
      notification.style.animation =
        "notificationFadeOut 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55)";
      setTimeout(() => notification.remove(), 400);
    }, 5000);
  }
}

class ActivityProcessorUI {
  constructor(courseId) {
    this.requestManager = new RequestManager();
    this.examAutomator = new ExamAutomator();
    this.pageCompletionService = new PageCompletionService();
    this.notificationManager = new NotificationManager();

    this.courseId = courseId;
    this.isProcessing = false;

    this.notificationManager.showNotification(
      "Script Iniciado!",
      "Expansão do foda-se iniciada com sucesso!",
      "success",
    );
  }

  async processActivities() {
    if (this.isProcessing) {
      this.notificationManager.showNotification(
        "Aviso",
        "O processamento já está em andamento.",
        "info",
      );
      return;
    }

    this.isProcessing = true;
    try {
      let coursePageDom = await this.requestManager
        .fetchWithRetry(`/course/view.php?id=${this.courseId}`)
        .then((response) => {
          if (!response.ok) {
            this.notificationManager.showNotification(
              "Erro",
              "Não foi possível carregar o curso",
              "error",
            );
            throw new Error("Unable to load course page");
          }
          return response.text();
        })
        .then((html) => {
          const parser = new DOMParser();
          return parser.parseFromString(html, "text/html");
        });

      const activities = Array.from(
        coursePageDom.querySelectorAll(
          "li.activity.modtype_resource, li.activity.modtype_quiz",
        ),
      ).filter((activity) => {
        const completionButton = activity.querySelector(
          ".completion-dropdown button",
        );
        const link = activity.querySelector("a.aalink");
        return (
          link?.href &&
          (!completionButton ||
            !completionButton.classList.contains("btn-success"))
        );
      });

      const simplePages = [];
      const exams = [];

      activities.forEach((activity) => {
        const link = activity.querySelector("a.aalink");
        const url = new URL(link.href);
        const pageId = url.searchParams.get("id");
        const activityName = link.textContent.trim();

        if (pageId) {
          if (/responda|pause/i.test(activityName)) {
            exams.push({ href: link.href, nome: activityName });
          } else {
            simplePages.push(pageId);
          }
        }
      });

      if (simplePages.length === 0 && exams.length === 0) {
        this.notificationManager.showNotification(
          "Finalizado",
          "Atividades Finalizadas! | Caso Sobrar alguma execute novamente",
          "success",
        );
        setTimeout(() => {
          location.reload();
        }, 1000);
        return;
      }

      if (simplePages.length > 0) {
        this.notificationManager.showNotification(
          "Progresso",
          `Marcando ${simplePages.length} atividades como concluídas...`,
          "info",
        );
        await Promise.all(
          simplePages.map((pageId) =>
            this.pageCompletionService.markPageAsCompleted(pageId),
          ),
        );
      }

      if (exams.length > 0) {
        const totalExams = exams.length;
        this.notificationManager.showNotification(
          "Progresso",
          `Processando ${totalExams} exames...`,
          "info",
        );

        for (let i = 0; i < totalExams; i++) {
          const exam = exams[i];
          this.notificationManager.showNotification(
            "Exame",
            `Processando: "${exam.nome}" (${i + 1}/${totalExams})`,
            "info",
          );

          await this.examAutomator.completeExam(exam.href);

          if (i < totalExams - 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
      }

      this.notificationManager.showNotification(
        "Sucesso",
        "Processamento concluído com sucesso!",
        "success",
      );

      this.notificationManager.showNotification(
        "Atividades Restantes",
        "Tentando encontrar atividades restantes",
        "info",
      );
      this.isProcessing = false;
      return this.processActivities();
    } catch (error) {
      this.notificationManager.showNotification(
        "Erro",
        "Ocorreu um erro durante o processamento",
        "error",
      );
    } finally {
      this.isProcessing = false;
    }
  }
}

function initActivityProcessor() {
  if (window.location.hostname !== "expansao.educacao.sp.gov.br") {
    const notification = new NotificationManager();
    notification.showNotification(
      "Erro",
      "Este script só funciona no site da Expansão Educacional de SP",
      "error",
    );
    return;
  }

  if (window.location.pathname !== "/course/view.php") {
    const notification = new NotificationManager();
    notification.showNotification(
      "Erro",
      "Por favor selecione um curso antes de executar o script",
      "error",
    );
    return;
  }

  const processor = new ActivityProcessorUI(
    new URLSearchParams(window.location.search).get("id"),
  );

  setTimeout(() => {
    processor.processActivities();
  }, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initActivityProcessor);
} else {
  initActivityProcessor();
}
