import * as fs from "fs-extra";
import { LoadWebservice } from './load-web-service';
import { IService, INodeWithServices, Configuration } from 'dockerproxy-commons';
import { Scheduler } from './scheduler';

const nodesWithService: INodeWithServices[] = [];
const servicesAll: IService[] = [];

const configuration: Configuration = Configuration.INSTANCE;
const errors: string[] = configuration.checkConfEntries(["webservice"]);
if (errors.length > 0) {
    throw new Error('Variables not detected : "' + errors.join('", "') + '"');
}
const webServiceScript: string = configuration.getEnvVariable("webservice");
LoadWebservice.load(webServiceScript).then((pWebServiceInstance) => {
    const scheduler = new Scheduler(pWebServiceInstance);
    scheduler.start();
});
