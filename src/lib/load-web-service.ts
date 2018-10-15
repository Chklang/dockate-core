import * as http from "http";
import * as https from "https";
import * as fs from "fs-extra";
import { IWebService, Configuration } from 'dockerproxy-commons';

export class LoadWebservice {
    public static load(webServiceScript: string): Promise<IWebService> {
        let promiseLoadScript: Promise<{ new(): IWebService }> = null;
        if (webServiceScript.startsWith("file://")) {
            promiseLoadScript = Promise.resolve(eval(fs.readFileSync(webServiceScript.replace("file://", "")).toString()));
        } else if (webServiceScript.startsWith("http://")) {
            promiseLoadScript = new Promise((resolve, reject) => {
                http.get(webServiceScript, (request) => {
                    const { statusCode } = request;
                    let rawData = '';
                    request.on('data', (chunk) => { rawData += chunk; });
                    request.on('end', () => {
                        if (statusCode >= 400) {
                            reject(new Error("Cannot get " + webServiceScript + ", statuscode=" + statusCode + ", content : " + rawData));
                            return;
                        }
                        resolve(eval(rawData));
                    });
                }).on('error', (e) => {
                    reject(new Error("Cannot get " + webServiceScript + ", error : " + e));
                });
            });
        } else if (webServiceScript.startsWith("https://")) {
            promiseLoadScript = new Promise((resolve, reject) => {
                https.get(webServiceScript, (request) => {
                    const { statusCode } = request;
                    let rawData = '';
                    request.on('data', (chunk) => { rawData += chunk; });
                    request.on('end', () => {
                        if (statusCode >= 400) {
                            reject(new Error("Cannot get " + webServiceScript + ", statuscode=" + statusCode + ", content : " + rawData));
                            return;
                        }
                        resolve(eval(rawData));
                    });
                }).on('error', (e) => {
                    reject(new Error("Cannot get " + webServiceScript + ", error : " + e));
                });
            });
        } else {
            return Promise.reject(new Error("Protocol for " + webServiceScript + " is unsupported"));
        }
        return promiseLoadScript.then((webServiceClass) => {
            const webServiceInstance: IWebService = new webServiceClass();
            const configuration: Configuration = Configuration.INSTANCE;
            configuration.addConfigEntries(webServiceInstance.getConfEntries());
            return webServiceInstance;
        });
    }
}