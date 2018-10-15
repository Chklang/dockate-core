# Goal of dockerproxy
This node project was created to permit to configure an external router for a docker network, without install docker on the router

# How to run
execute node exec.js with params. Minimist are :
```shell
node exec.js \
	--dockerproxy.swarmHost "<swarm host ip>" \
	--dockerproxy.swarmPortHTTP "<swarm host port for docker API>" \
	--dockerproxy.swarmPortSSH "<swarm host port for SSH (docker not expose 'docker node ps <nodeid>' on API)>" \
	--dockerproxy.swarmUsername "<swarm host ssh login>" \
	--dockerproxy.swarmPassword "<swarm host ssh password>" \
    --dockerproxy.webservice "<path to js to control webservice>"
```

# Give a webservice
Actually, there is these webservices :
* [haproxy](https://www.google.fr)